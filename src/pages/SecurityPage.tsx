import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Fingerprint, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
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
import { verifyPin } from '../data/crypto/cryptoService';
import {
	describeBiometricReason,
	disableBiometric,
	enrollBiometricUnlock,
	getBiometricAvailability,
	isBiometricEnrolled,
	type BiometricAvailability
} from '../lib/biometric';
import type { UserProfile } from '../domain/entities';

const AUTO_LOCK_CHOICES_MIN = [1, 2, 5, 15, 30] as const;

// Fingerprint unlock and the auto-lock timeout. Biometric only ever recovers the PIN (it never
// bypasses it), so turning it on needs the PIN once more.
export function SecurityPage() {
	const { setAutoLockTimeout } = useSession();
	const [profile, setProfile] = useState<UserProfile | null>(null);
	const [availability, setAvailability] = useState<BiometricAvailability | null>(null);
	const [enrolled, setEnrolled] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [pin, setPin] = useState('');
	const [busy, setBusy] = useState(false);

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
			const correct = await verifyPin(pin, profile.pinSalt, profile.pinVerifierHash);
			if (!correct) {
				toast.error('Incorrect PIN.');
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
		} finally {
			setBusy(false);
		}
	}

	async function handleTimeoutChange(value: string) {
		const timeoutMs = Number(value) * 60_000;
		await UserProfileRepository.update({ autoLockTimeoutMs: timeoutMs });
		setAutoLockTimeout(timeoutMs);
		setProfile((p) => (p ? { ...p, autoLockTimeoutMs: timeoutMs } : p));
		toast.success('Auto-lock updated');
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
				<CardContent>
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
		</div>
	);
}
