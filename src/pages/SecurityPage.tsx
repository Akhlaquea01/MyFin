import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Fingerprint, KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '../components/ui/dialog';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import { useSession } from '../context/SessionContext';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';
import { checkPinWithThrottle } from '../data/auth/pinGate';
import { ChangePinError, changePin } from '../data/io/changePinService';
import {
	describeBiometricReason,
	disableBiometric,
	enrollBiometricUnlock,
	getBiometricAvailability,
	isBiometricEnrolled,
	type BiometricAvailability
} from '../lib/biometric';
import { MAX_PIN_LENGTH, MIN_PIN_LENGTH } from '../domain/auth/pinPolicy';
import type { UserProfile } from '../domain/entities';

const AUTO_LOCK_CHOICES_MIN = [1, 2, 5, 15, 30] as const;

// Fingerprint unlock, the PIN, and the auto-lock timeout. Biometric only ever recovers the PIN (it
// never bypasses it), so turning it on needs the PIN once more.
export function SecurityPage() {
	const { setAutoLockTimeout, setLockOnBackground, getEncryptionKey, lock } = useSession();
	const [profile, setProfile] = useState<UserProfile | null>(null);
	const [availability, setAvailability] = useState<BiometricAvailability | null>(null);
	const [enrolled, setEnrolled] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [pin, setPin] = useState('');
	const [busy, setBusy] = useState(false);

	const [changeOpen, setChangeOpen] = useState(false);
	const [currentPin, setCurrentPin] = useState('');
	const [newPin, setNewPin] = useState('');
	const [confirmNewPin, setConfirmNewPin] = useState('');
	const [changeError, setChangeError] = useState<string | null>(null);
	const [changing, setChanging] = useState(false);

	const refresh = useCallback(async () => {
		const p = (await UserProfileRepository.get()) ?? null;
		setProfile(p);
		setAvailability(await getBiometricAvailability());
		setEnrolled(await isBiometricEnrolled(p));
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	async function handleEnable(event: FormEvent) {
		event.preventDefault();
		if (!profile) return;
		setBusy(true);
		try {
			const check = await checkPinWithThrottle(pin);
			if (!check.ok) {
				toast.error(check.message);
				return;
			}
			const result = await enrollBiometricUnlock(pin);
			if (!result.ok) {
				toast.error(describeBiometricReason(result.reason));
				return;
			}
			await UserProfileRepository.update(result.profilePatch);
			setDialogOpen(false);
			toast.success('Fingerprint unlock is on');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not turn on fingerprint unlock.');
		} finally {
			setPin('');
			setBusy(false);
		}
	}

	async function handleDisable() {
		setBusy(true);
		try {
			await disableBiometric();
			toast.success('Fingerprint unlock is off');
			await refresh();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not turn off fingerprint unlock.');
		} finally {
			setBusy(false);
		}
	}

	async function handleTimeoutChange(value: string) {
		const timeoutMs = Number(value) * 60_000;
		try {
			await UserProfileRepository.update({ autoLockTimeoutMs: timeoutMs });
			setAutoLockTimeout(timeoutMs);
			setProfile((p) => (p ? { ...p, autoLockTimeoutMs: timeoutMs } : p));
			toast.success('Auto-lock updated');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save the auto-lock time.');
		}
	}

	async function handleLockOnBackgroundChange(enabled: boolean) {
		try {
			await UserProfileRepository.update({ lockOnBackground: enabled });
			setLockOnBackground(enabled);
			setProfile((p) => (p ? { ...p, lockOnBackground: enabled } : p));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not save that setting.');
		}
	}

	function resetChangeForm() {
		setCurrentPin('');
		setNewPin('');
		setConfirmNewPin('');
		setChangeError(null);
	}

	async function handleChangePin(event: FormEvent) {
		event.preventDefault();
		setChangeError(null);
		if (newPin !== confirmNewPin) {
			setChangeError('The new PINs do not match.');
			return;
		}
		setChanging(true);
		try {
			const check = await checkPinWithThrottle(currentPin);
			if (!check.ok) {
				setChangeError(check.message);
				return;
			}
			await changePin(getEncryptionKey(), currentPin, newPin);
			setChangeOpen(false);
			resetChangeForm();
			toast.success('PIN changed. Unlock with your new PIN.');
			// The database is now encrypted under the new PIN's key; the running session still holds
			// the old one, so it must end here.
			lock();
		} catch (err) {
			setChangeError(
				err instanceof ChangePinError
					? err.message
					: 'Could not change the PIN. Nothing was changed.'
			);
		} finally {
			setChanging(false);
		}
	}

	const timeoutMin = profile ? Math.round(profile.autoLockTimeoutMs / 60_000) : 5;
	const timeoutChoices = AUTO_LOCK_CHOICES_MIN.includes(timeoutMin as 1)
		? [...AUTO_LOCK_CHOICES_MIN]
		: [...AUTO_LOCK_CHOICES_MIN, timeoutMin].sort((a, b) => a - b);

	return (
		<div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
			<h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
				<ShieldCheck className="size-6" /> Security
			</h1>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<KeyRound className="size-5" /> PIN
					</CardTitle>
					<CardDescription>
						Your PIN encrypts everything on this device and every backup you export. Changing it
						re-encrypts your data under the new PIN. Backups you made earlier still need the PIN
						they were created with.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button variant="outline" onClick={() => setChangeOpen(true)}>
						Change PIN
					</Button>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Fingerprint className="size-5" /> Fingerprint unlock
					</CardTitle>
					<CardDescription>
						Use your fingerprint instead of typing your PIN. Your PIN still works, and it is still
						what protects your data.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-3">
					{availability === null ? (
						<p className="text-sm text-muted-foreground">Checking…</p>
					) : !availability.available ? (
						<p className="text-sm text-muted-foreground">
							{describeBiometricReason(availability.reason ?? 'unsupported')}
						</p>
					) : (
						<p className="text-sm">
							Status: <strong>{enrolled ? 'On' : 'Off'}</strong>
							{availability.provider === 'webauthn' ? ' (browser passkey)' : ''}
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						{availability?.available && !enrolled && (
							<Button disabled={busy} onClick={() => setDialogOpen(true)}>
								Turn on
							</Button>
						)}
						{enrolled && (
							<Button variant="outline" disabled={busy} onClick={() => void handleDisable()}>
								Turn off
							</Button>
						)}
						{availability && !availability.available && (
							<Button variant="outline" onClick={() => void refresh()}>
								Check again
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Auto-lock</CardTitle>
					<CardDescription>
						Ask for your PIN or fingerprint again after the app has been away or idle this long.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-5">
					<div className="flex max-w-xs flex-col gap-1.5">
						<Label htmlFor="auto-lock-timeout">Lock after</Label>
						<Select value={String(timeoutMin)} onValueChange={(v) => void handleTimeoutChange(v)}>
							<SelectTrigger id="auto-lock-timeout" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{timeoutChoices.map((m) => (
									<SelectItem key={m} value={String(m)}>
										{m} {m === 1 ? 'minute' : 'minutes'}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="flex items-start justify-between gap-4">
						<div>
							<Label htmlFor="lock-on-background">Lock when I leave the app</Label>
							<p className="text-xs text-muted-foreground">
								Locks if MyFin has been out of the foreground for more than 30 seconds, whatever the
								time above. A quick permission prompt or file picker will not lock it.
							</p>
						</div>
						<Switch
							id="lock-on-background"
							checked={!!profile?.lockOnBackground}
							disabled={!profile}
							onCheckedChange={(enabled) => void handleLockOnBackgroundChange(enabled)}
						/>
					</div>
				</CardContent>
			</Card>

			<Dialog open={dialogOpen} onOpenChange={(open) => !busy && setDialogOpen(open)}>
				<DialogContent>
					<form className="flex flex-col gap-4" onSubmit={(e) => void handleEnable(e)}>
						<DialogHeader>
							<DialogTitle>Turn on fingerprint unlock</DialogTitle>
							<DialogDescription>
								Enter your PIN, then confirm with your fingerprint.
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="security-pin">PIN</Label>
							<Input
								id="security-pin"
								type="password"
								inputMode="numeric"
								autoComplete="current-password"
								value={pin}
								onChange={(e) => setPin(e.target.value)}
								autoFocus
							/>
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={busy || !pin}>
								{busy ? 'Working…' : 'Continue'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog
				open={changeOpen}
				onOpenChange={(open) => {
					if (changing) return;
					setChangeOpen(open);
					if (!open) resetChangeForm();
				}}
			>
				<DialogContent>
					<form className="flex flex-col gap-4" onSubmit={(e) => void handleChangePin(e)}>
						<DialogHeader>
							<DialogTitle>Change PIN</DialogTitle>
							<DialogDescription>
								Choose a new {MIN_PIN_LENGTH}-{MAX_PIN_LENGTH} digit PIN. Your data is re-encrypted
								on this device, which can take a few seconds. Fingerprint unlock turns off and can
								be set up again afterwards. There is no way to recover a forgotten PIN.
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="current-pin">Current PIN</Label>
							<Input
								id="current-pin"
								type="password"
								inputMode="numeric"
								autoComplete="current-password"
								value={currentPin}
								onChange={(e) => setCurrentPin(e.target.value)}
								disabled={changing}
								autoFocus
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="new-pin">New PIN</Label>
							<Input
								id="new-pin"
								type="password"
								inputMode="numeric"
								autoComplete="new-password"
								value={newPin}
								onChange={(e) => setNewPin(e.target.value)}
								disabled={changing}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="confirm-new-pin">Confirm new PIN</Label>
							<Input
								id="confirm-new-pin"
								type="password"
								inputMode="numeric"
								autoComplete="new-password"
								value={confirmNewPin}
								onChange={(e) => setConfirmNewPin(e.target.value)}
								disabled={changing}
							/>
						</div>
						{changeError && (
							<p role="alert" className="text-sm text-destructive">
								{changeError}
							</p>
						)}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={changing}
								onClick={() => {
									setChangeOpen(false);
									resetChangeForm();
								}}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={changing || !currentPin || !newPin || !confirmNewPin}>
								{changing ? 'Re-encrypting…' : 'Change PIN'}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
