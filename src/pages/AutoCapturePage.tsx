import { useCallback, useEffect, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
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
import { useShowMore } from '../hooks/useShowMore';
import { ShowMoreButton } from '../components/ShowMoreButton';
import { AccountRepository } from '../data/dexie/accountRepository';
import { UnreadableCaptureRepository } from '../data/dexie/unreadableCaptureRepository';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';
import { CaptureSetupError, disableCapture, enableCapture } from '../data/io/captureSetup';
import { drainCapturedTransactions } from '../data/io/captureDrain';
import {
	TransactionCapture,
	isTransactionCaptureAvailable,
	type CaptureStatus,
	type PermissionState
} from '../lib/native/transactionCapture';
import type { Account, CaptureSettings, UnreadableCapture } from '../domain/entities';

// Up to UNREADABLE_CAPTURE_LIMIT messages are kept, each a card with its full text.
const MESSAGES_PAGE_SIZE = 10;

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

/** Plain-words names for the reasons a message was ignored (see `IgnoreReason`). */
const IGNORE_REASON_TEXT: Record<string, string> = {
	otp: 'one-time code',
	promo: 'offer',
	'not-transactional': 'not about money',
	failed: 'failed payment',
	'future-or-request': 'reminder or request',
	'balance-only': 'balance alert',
	'personal-sender': 'from a person',
	'too-long': 'too long',
	'no-amount': 'no amount'
};

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
	// The page is also rendered outside a router in component tests; links only exist inside one.
	const inRouter = useInRouterContext();

	const [status, setStatus] = useState<CaptureStatus | null>(null);
	const [settings, setSettings] = useState<CaptureSettings | null>(null);
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [smsOn, setSmsOn] = useState(true);
	const [notificationsOn, setNotificationsOn] = useState(true);
	const [defaultAccountId, setDefaultAccountId] = useState('');
	const [loaded, setLoaded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [blockedHint, setBlockedHint] = useState(false);
	const [filingNow, setFilingNow] = useState(false);
	// Messages that looked like transactions but could not be read, kept so they can be added by hand.
	const [unreadable, setUnreadable] = useState<UnreadableCapture[]>([]);

	const refresh = useCallback(async () => {
		if (!available) return;
		try {
			const [profile, accts, current, kept] = await Promise.all([
				UserProfileRepository.get(),
				AccountRepository.list(key, false),
				TransactionCapture.getStatus(),
				UnreadableCaptureRepository.list(key)
			]);
			setStatus(current);
			setUnreadable(kept);
			setSettings(profile?.capture ?? null);
			setAccounts(accts);
			if (!loaded) {
				const saved = profile?.capture;
				// Prefer the one non-card account; a user whose only account is a credit card can
				// still turn capture on.
				const nonCard = accts.filter((a) => a.type !== 'credit_card');
				const suggested = nonCard.length === 1 ? nonCard[0] : accts.length === 1 ? accts[0] : null;
				setSmsOn(saved?.sms ?? true);
				setNotificationsOn(saved?.notifications ?? true);
				// A saved default that has since been deleted or archived is not offered back as if it still
				// worked: messages cannot be filed there, so the page asks for a new one.
				const savedId = saved?.defaultAccountId ?? null;
				const savedStillUsable = savedId !== null && accts.some((a) => a.id === savedId);
				setDefaultAccountId(savedStillUsable ? savedId : savedId ? '' : (suggested?.id ?? ''));
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

	// Kept for two different reasons: read fine but nowhere to file them, or not understood.
	const unfiled = unreadable.filter((item) => item.reason === 'no-account');
	const unread = unreadable.filter((item) => item.reason !== 'no-account');
	const unfiledPaging = useShowMore(unfiled.length, MESSAGES_PAGE_SIZE);
	const unreadPaging = useShowMore(unread.length, MESSAGES_PAGE_SIZE);

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

	// Any account can be the default: messages that name an account or card by its digits are filed
	// there regardless, and a card-only user has nothing else to pick.
	const eligibleAccounts = accounts;
	const enabled = !!settings?.enabled;
	const ignoredTotal = Object.values(settings?.ignoredCounts ?? {}).reduce((a, b) => a + b, 0);
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

	/** Tries to file whatever is waiting right now instead of waiting for the next unlock. */
	async function fileNow() {
		setFilingNow(true);
		try {
			await drainCapturedTransactions(key);
			await refresh();
		} catch {
			toast.error('Could not file the waiting messages.');
		} finally {
			setFilingNow(false);
		}
	}

	async function dismissUnreadable(id: string) {
		try {
			await UnreadableCaptureRepository.remove(id);
			setUnreadable((prev) => prev.filter((u) => u.id !== id));
		} catch {
			toast.error('Could not remove that message.');
		}
	}

	async function dismissAllUnreadable() {
		try {
			// Only the ones that could not be read: those waiting for an account are not "dismissed" by
			// this, they are filed as soon as there is somewhere to put them.
			for (const item of unreadable.filter((u) => u.reason !== 'no-account')) {
				await UnreadableCaptureRepository.remove(item.id);
			}
			setUnreadable((prev) => prev.filter((u) => u.reason === 'no-account'));
		} catch {
			toast.error('Could not clear the list.');
		}
	}

	/** The counters only ever grow; this lets the user say "I've seen it". */
	async function clearNotices() {
		try {
			const profile = await UserProfileRepository.get();
			if (profile?.capture) {
				await UserProfileRepository.update({
					capture: { ...profile.capture, unreadableCount: 0, droppedCount: 0, ignoredCounts: {} }
				});
			}
			await refresh();
		} catch {
			toast.error('Could not clear the notices.');
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
						MyFin keeps only messages that look like completed bank transactions: from your bank, a
						payment app, or a bank alert in your messages app. One-time codes, offers, balance
						alerts and everyone else's messages are ignored and never stored. Each message is locked
						on arrival and can only be opened after you unlock MyFin, so nothing readable is kept
						while the app is locked.
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
						Lets MyFin see notifications from your payment, bank and messages apps, and keep only
						the ones that look like bank alerts. In Android's list, switch on MyFin, then come back.
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
										{a.type === 'credit_card' ? `${a.name} (credit card)` : a.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Used when a message does not say which account it is about. Messages name an account
							or card by its last digits; add them under Accounts so each one is filed correctly. A
							message that says "credit card" goes to your credit card account when you have just
							one.
						</p>
						{eligibleAccounts.length === 0 && (
							<p className="text-xs text-amber-700 dark:text-amber-400">
								You have no account to file messages under yet.
								{inRouter && (
									<>
										{' '}
										<Link to="/accounts" className="font-medium underline underline-offset-2">
											Add an account
										</Link>
										, then come back.
									</>
								)}
							</p>
						)}
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
						</p>
						{status.pending > 0 && (
							<div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
								<p>
									MyFin files these each time it is open and unlocked. If the number does not go
									down, they could not be matched to an account — most often because no default
									account is chosen, or the one chosen was archived or removed. Pick one above and
									save, then file them.
								</p>
								<div>
									<Button
										size="sm"
										variant="outline"
										disabled={filingNow}
										onClick={() => void fileNow()}
									>
										{filingNow ? 'Filing…' : 'File them now'}
									</Button>
								</div>
							</div>
						)}
						{settings?.lastDrainAt && (
							<p className="text-muted-foreground">
								Last checked {new Date(settings.lastDrainAt).toLocaleString()}
							</p>
						)}
						{(settings?.unreadableCount ?? 0) > 0 && (
							<p className="text-muted-foreground">
								{settings?.unreadableCount} message(s) looked like transactions but could not be
								read.
								{unread.length > 0
									? ' The ones MyFin could open are listed below so you can add them by hand.'
									: ' Add any you recognise by hand or with Quick Add.'}
							</p>
						)}
						{(settings?.droppedCount ?? 0) + status.dropped > 0 && (
							<p className="text-amber-700 dark:text-amber-400">
								{(settings?.droppedCount ?? 0) + status.dropped} older message(s) were discarded
								because too many piled up while MyFin was locked.
							</p>
						)}
						{ignoredTotal > 0 && (
							<p className="text-muted-foreground">
								{ignoredTotal} message(s) were ignored as not being transactions:{' '}
								{Object.entries(settings?.ignoredCounts ?? {})
									.filter(([, count]) => count > 0)
									.map(([reason, count]) => `${count} ${IGNORE_REASON_TEXT[reason] ?? reason}`)
									.join(', ')}
								. If a bank message you expected is missing, it may be one of these.
							</p>
						)}
						{((settings?.unreadableCount ?? 0) > 0 ||
							(settings?.droppedCount ?? 0) + status.dropped > 0 ||
							ignoredTotal > 0) && (
							<div>
								<Button size="sm" variant="ghost" onClick={() => void clearNotices()}>
									Clear these notices
								</Button>
							</div>
						)}
					</CardContent>
				</Card>
			)}

			{unfiled.length > 0 && (
				<Card className="border-amber-500/60">
					<CardHeader>
						<CardTitle>Messages waiting for an account</CardTitle>
						<CardDescription>
							These were understood, but no account matched them and there is no default account to
							put them in. Choose a default account above and they are filed automatically the next
							time MyFin checks.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						{unfiled.slice(0, unfiledPaging.visible).map((item) => (
							<div key={item.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
								<p className="text-xs text-muted-foreground">
									{item.sender} · {new Date(item.receivedAt).toLocaleString()}
								</p>
								<p className="break-words whitespace-pre-wrap">{item.text}</p>
								<div className="flex flex-wrap gap-2">
									<Button size="sm" variant="ghost" onClick={() => void dismissUnreadable(item.id)}>
										Discard
									</Button>
								</div>
							</div>
						))}
						<ShowMoreButton
							hidden={unfiledPaging.hidden}
							step={MESSAGES_PAGE_SIZE}
							onClick={unfiledPaging.showMore}
						/>
						<div>
							<Button
								size="sm"
								variant="outline"
								disabled={filingNow}
								onClick={() => void fileNow()}
							>
								{filingNow ? 'Filing…' : 'Try filing them now'}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{unread.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>Messages MyFin could not read</CardTitle>
						<CardDescription>
							These looked like bank transactions but their wording was not understood, so no entry
							was made. Add the ones that matter by hand — Quick Add opens with the text already
							pasted in.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						{unread.slice(0, unreadPaging.visible).map((item) => (
							<div key={item.id} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
								<p className="text-xs text-muted-foreground">
									{item.sender} · {new Date(item.receivedAt).toLocaleString()}
								</p>
								<p className="break-words whitespace-pre-wrap">{item.text}</p>
								<div className="flex flex-wrap gap-2">
									{inRouter && (
										<Button size="sm" variant="outline" asChild>
											<Link to="/quick-add" state={{ sharedText: item.text }}>
												Add by hand
											</Link>
										</Button>
									)}
									<Button size="sm" variant="ghost" onClick={() => void dismissUnreadable(item.id)}>
										Dismiss
									</Button>
								</div>
							</div>
						))}
						<ShowMoreButton
							hidden={unreadPaging.hidden}
							step={MESSAGES_PAGE_SIZE}
							onClick={unreadPaging.showMore}
						/>
						<div>
							<Button size="sm" variant="ghost" onClick={() => void dismissAllUnreadable()}>
								Dismiss all
							</Button>
						</div>
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
