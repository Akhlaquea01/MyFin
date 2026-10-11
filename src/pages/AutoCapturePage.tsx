import { useCallback, useEffect, useState } from 'react';
import { BellRing, CheckCircle2, CircleAlert, MessageSquareText, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { useSession } from '../context/SessionContext';
import { useAppActive } from '../hooks/useAppActive';
import { AccountRepository } from '../data/dexie/accountRepository';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';
import { CaptureSetupError, disableCapture, enableCapture } from '../data/io/captureSetup';
import { drainCapturedTransactions } from '../data/io/captureDrain';
import {
	TransactionCapture,
	isTransactionCaptureAvailable,
	type CaptureStatus,
	type PermissionState
} from '../lib/native/transactionCapture';
import type { Account, CaptureSettings } from '../domain/entities';

/** Android 13 added the runtime permission for an app's own notifications. */
const POST_NOTIFICATIONS_API = 33;

function StateBadge({ ok, okText, notOkText }: { ok: boolean; okText: string; notOkText: string }) {
	return ok ? (
		<Badge variant="secondary" className="gap-1">
			<CheckCircle2 className="size-3 text-emerald-600 dark:text-emerald-400" /> {okText}
		</Badge>
	) : (
		<Badge variant="outline" className="gap-1">
			<CircleAlert className="size-3 text-amber-600 dark:text-amber-400" /> {notOkText}
		</Badge>
	);
}

function permissionText(state: PermissionState): string {
	return state === 'denied' ? 'Blocked' : 'Not allowed yet';
}

// Reads bank SMS and payment-app notifications on the Android app and files them in Review. The
// messages are locked away by the phone as they arrive and only opened here, after you unlock
// (see data/crypto/sealedBox.ts), so nothing readable is stored while the app is locked.
export function AutoCapturePage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const { activationCount } = useAppActive();
	const available = isTransactionCaptureAvailable();

	const [status, setStatus] = useState<CaptureStatus | null>(null);
	const [settings, setSettings] = useState<CaptureSettings | null>(null);
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [smsOn, setSmsOn] = useState(true);
	const [notificationsOn, setNotificationsOn] = useState(true);
	const [defaultAccountId, setDefaultAccountId] = useState('');
	const [loaded, setLoaded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [blockedHint, setBlockedHint] = useState(false);

	const refresh = useCallback(async () => {
		if (!available) return;
		try {
			const [profile, accts, current] = await Promise.all([
				UserProfileRepository.get(),
				AccountRepository.list(key, false),
				TransactionCapture.getStatus()
			]);
			setStatus(current);
			setSettings(profile?.capture ?? null);
			setAccounts(accts);
			if (!loaded) {
				const saved = profile?.capture;
				const eligible = accts.filter((a) => a.type !== 'credit_card');
				setSmsOn(saved?.sms ?? true);
				setNotificationsOn(saved?.notifications ?? true);
				setDefaultAccountId(
					saved?.defaultAccountId ?? (eligible.length === 1 ? eligible[0].id : '')
				);
				setLoaded(true);
			}
		} catch {
			toast.error('Could not read the capture status from the phone.');
		}
	}, [available, key, loaded]);

	// Re-read when the page opens and each time the app comes back — the user leaves it to flip
	// switches in Android settings.
	useEffect(() => {
		void refresh();
	}, [refresh, activationCount]);

	if (!available) {
		return (
			<div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
				<h1 className="mb-6 flex items-center gap-2 text-2xl font-semibold tracking-tight">
					<Smartphone className="size-6" /> Auto-capture
				</h1>
				<Card className="border-dashed">
					<CardContent className="py-8 text-center text-sm text-muted-foreground">
						Reading bank SMS and payment notifications is only available in the MyFin Android app.
						On the web, paste a message into Quick Add instead.
					</CardContent>
				</Card>
			</div>
		);
	}

	const eligibleAccounts = accounts.filter((a) => a.type !== 'credit_card');
	const enabled = !!settings?.enabled;
	const sdk = status?.sdkInt ?? 0;

	const missing: string[] = [];
	if (smsOn && status?.sms !== 'granted') missing.push('allow reading SMS');
	if (notificationsOn && !status?.notificationListenerEnabled)
		missing.push('turn on notification access');
	if (!smsOn && !notificationsOn) missing.push('choose at least one source');
	if (!defaultAccountId) missing.push('choose a default account');

	async function ask(permission: 'sms' | 'postNotifications') {
		setBusy(true);
		try {
			const result = await TransactionCapture.requestPermissions([permission]);
			await refresh();
			if (result[permission] !== 'granted') {
				setBlockedHint(true);
				toast.error('Android did not allow that. See "If Android blocks this" below.');
			}
		} finally {
			setBusy(false);
		}
	}

	async function turnOn() {
		setBusy(true);
		try {
			await enableCapture(key, { sms: smsOn, notifications: notificationsOn, defaultAccountId });
			toast.success('Auto-capture is on');
			await refresh();
			// Pick up anything that arrived while this was being set up.
			await drainCapturedTransactions(key).catch(() => null);
		} catch (err) {
			toast.error(
				err instanceof CaptureSetupError
					? err.message
					: 'Could not turn on auto-capture. Nothing was captured.'
			);
		} finally {
			setBusy(false);
		}
	}

	async function turnOff() {
		setBusy(true);
		try {
			await disableCapture();
			toast.success('Auto-capture is off');
			await refresh();
		} catch {
			toast.error('Could not turn off auto-capture.');
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
			<h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
				<Smartphone className="size-6" /> Auto-capture
			</h1>

			<Card>
				<CardHeader>
					<CardTitle>Add bank transactions to Review automatically</CardTitle>
					<CardDescription>
						When your bank texts you about money moving, or a payment app (GPay, PhonePe, Paytm,
						your bank's app) posts a notification, MyFin reads the amount and who it was with and
						adds it to your Review queue. You check it, fix anything that is off, and confirm.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
					<p>
						MyFin keeps only messages that look like completed transactions, and from payment apps
						only. One-time codes, offers, balance alerts and everyone else's messages are ignored
						and never stored. Each message is locked on arrival and can only be opened after you
						unlock MyFin, so nothing readable is kept while the app is locked.
					</p>
					<p>Nothing leaves your phone.</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Permissions</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<MessageSquareText className="size-4" />
							<span className="text-sm font-medium">Read incoming SMS</span>
							{status && (
								<StateBadge
									ok={status.sms === 'granted'}
									okText="Allowed"
									notOkText={permissionText(status.sms)}
								/>
							)}
						</div>
						{status?.sms !== 'granted' && (
							<Button size="sm" disabled={busy} onClick={() => void ask('sms')}>
								Allow
							</Button>
						)}
					</div>

					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<BellRing className="size-4" />
							<span className="text-sm font-medium">Notification access</span>
							{status && (
								<StateBadge ok={status.notificationListenerEnabled} okText="On" notOkText="Off" />
							)}
						</div>
						{!status?.notificationListenerEnabled && (
							<Button
								size="sm"
								variant="outline"
								onClick={() => void TransactionCapture.openNotificationAccessSettings()}
							>
								Open settings
							</Button>
						)}
					</div>
					<p className="-mt-2 text-xs text-muted-foreground">
						Lets MyFin see notifications from your payment and bank apps only. In Android's list,
						switch on MyFin, then come back.
					</p>

					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<BellRing className="size-4" />
							<span className="text-sm font-medium">Show an alert for new transactions</span>
							{status && (
								<StateBadge
									ok={
										sdk >= POST_NOTIFICATIONS_API
											? status.postNotifications === 'granted' && status.alertsEnabled
											: status.alertsEnabled
									}
									okText="Allowed"
									notOkText="Off"
								/>
							)}
						</div>
						{status && sdk >= POST_NOTIFICATIONS_API && status.postNotifications !== 'granted' && (
							<Button size="sm" disabled={busy} onClick={() => void ask('postNotifications')}>
								Allow
							</Button>
						)}
					</div>
					<p className="-mt-2 text-xs text-muted-foreground">
						The alert only says how many are waiting. It never shows an amount or a merchant.
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>What to capture</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<div className="flex items-center justify-between gap-3">
						<Label htmlFor="capture-sms">Bank SMS</Label>
						<Switch id="capture-sms" checked={smsOn} onCheckedChange={setSmsOn} disabled={busy} />
					</div>
					<div className="flex items-center justify-between gap-3">
						<Label htmlFor="capture-notifications">Payment and bank app notifications</Label>
						<Switch
							id="capture-notifications"
							checked={notificationsOn}
							onCheckedChange={setNotificationsOn}
							disabled={busy}
						/>
					</div>

					<div className="flex max-w-sm flex-col gap-1.5">
						<Label htmlFor="capture-default-account">Default account</Label>
						<Select value={defaultAccountId} onValueChange={setDefaultAccountId} disabled={busy}>
							<SelectTrigger id="capture-default-account" className="w-full">
								<SelectValue placeholder="Choose an account" />
							</SelectTrigger>
							<SelectContent>
								{eligibleAccounts.map((a) => (
									<SelectItem key={a.id} value={a.id}>
										{a.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Used when a message does not say which account it is about. Messages name an account
							by its last digits; add them under Accounts so each one is filed correctly.
						</p>
					</div>

					<div className="flex flex-wrap items-center gap-3">
						{enabled ? (
							<>
								<Button disabled={busy || missing.length > 0} onClick={() => void turnOn()}>
									Save changes
								</Button>
								<Button variant="outline" disabled={busy} onClick={() => void turnOff()}>
									Turn off
								</Button>
							</>
						) : (
							<Button disabled={busy || missing.length > 0} onClick={() => void turnOn()}>
								Turn on auto-capture
							</Button>
						)}
						{missing.length > 0 && (
							<p className="text-xs text-muted-foreground">To continue: {missing.join(', ')}.</p>
						)}
					</div>
				</CardContent>
			</Card>

			{enabled && status && (
				<Card>
					<CardHeader>
						<CardTitle>Status</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-1 text-sm">
						<p>
							Waiting to be filed: <strong>{status.pending}</strong>
							{status.pending > 0 ? ' (filed the next time MyFin is open and unlocked)' : ''}
						</p>
						{settings?.lastDrainAt && (
							<p className="text-muted-foreground">
								Last checked {new Date(settings.lastDrainAt).toLocaleString()}
							</p>
						)}
						{(settings?.unreadableCount ?? 0) > 0 && (
							<p className="text-muted-foreground">
								{settings?.unreadableCount} message(s) looked like transactions but could not be
								read. They were discarded; add those by hand or with Quick Add.
							</p>
						)}
						{(settings?.droppedCount ?? 0) + status.dropped > 0 && (
							<p className="text-amber-700 dark:text-amber-400">
								{(settings?.droppedCount ?? 0) + status.dropped} older message(s) were discarded
								because too many piled up while MyFin was locked.
							</p>
						)}
					</CardContent>
				</Card>
			)}

			<Card className={blockedHint ? 'border-amber-500/60' : undefined}>
				<CardHeader>
					<CardTitle>If Android blocks this</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
					<p>
						MyFin is installed from a file, not from Play Store. Android treats that as risky for
						reading SMS and notifications and may grey out the option or refuse it. To allow it:
						open <strong>App info</strong> for MyFin, tap the <strong>⋮ menu</strong> at the top
						right, choose <strong>Allow restricted settings</strong>, and then try again. The ⋮ menu
						only appears after you have tried once and been blocked.
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={() => void TransactionCapture.openAppSettings()}
						>
							Open App info
						</Button>
						<Button
							size="sm"
							variant="outline"
							onClick={() => void TransactionCapture.openNotificationAccessSettings()}
						>
							Open notification access
						</Button>
					</div>
					<p>
						Some phones stop apps that are not open. If messages arrive late or not at all, allow
						MyFin to run in the background (battery or autostart settings).
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
