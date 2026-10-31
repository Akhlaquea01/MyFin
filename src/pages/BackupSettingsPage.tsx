import { useEffect, useRef, useState } from 'react';
import { saveFile } from '../lib/saveFile';
import { DatabaseBackup, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from '../components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { DataIntegrityCard } from '../components/DataIntegrityCard';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle
} from '../components/ui/dialog';
import { useSession } from '../context/SessionContext';
import { TransactionRepository } from '../data/dexie/transactionRepository';
import { checkPinWithThrottle } from '../data/auth/pinGate';
import {
	createBackup,
	validateAndDecryptBackup,
	deriveDataKeyForPayload,
	restoreBackup,
	BackupValidationError,
	type BackupFile,
	type BackupPayload
} from '../data/io/backupService';
import { resetEverything } from '../data/io/resetService';
import {
	isAutoBackupSupported,
	requestBackupFolder,
	requestNativeBackupFolder,
	usesNativeBackupFolder,
	configureAutoBackup
} from '../data/io/autoBackupService';
import { AutoBackupSettingsRepository } from '../data/dexie/autoBackupSettingsRepository';
import type { AutoBackupSettings as ScheduledBackupSettings } from '../domain/entities';
import { enableBackupReminder, syncBackupReminder } from '../data/io/backupReminderService';
import { isNativeApp } from '../lib/native/platform';
import { isFolderPickCancelled } from '../lib/native/nativeBackupFolder';
import { KEEP_AUTO_BACKUPS } from '../data/io/autoBackupRetention';
import {
	BACKUP_REMINDER_INTERVAL_DAYS,
	daysSinceLastBackup,
	isBackupOverdue,
	loadBackupReminderSettings,
	recordManualBackup,
	saveBackupReminderSettings,
	type BackupReminderSettings
} from '../lib/backupReminder';
import { todayLocalISO } from '../domain/shared/dateMath';

/** Typed by the user to arm the restore / clear-all. Deliberately not a plain "Yes" — this
 *  wipes everything and cannot be undone (Constitution Principle VI). */
const RESTORE_CONFIRM_WORD = 'REPLACE';
const CLEAR_ALL_CONFIRM_WORD = 'DELETE EVERYTHING';
/** Backups embed receipt images as base64, so they can be large — but a file this big is not a
 *  MyFin backup, and reading it whole into memory would take the WebView down with it. */
const MAX_RESTORE_FILE_BYTES = 250 * 1024 * 1024;

interface PendingRestore {
	payload: BackupPayload;
	pin: string;
	fallbackSalt: string;
	incomingCount: number;
	currentCount: number;
	createdAt: string;
}

function formatBackupDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? 'an unknown date' : date.toLocaleDateString();
}

function describeLastBackup(days: number | null): string {
	if (days === null) return 'You have not made a backup on this device yet.';
	if (days === 0) return 'Last backup: today.';
	return `Last backup: ${days} day${days === 1 ? '' : 's'} ago.`;
}

// User Story 9 (P9): create/restore encrypted backups (FR-040-FR-043) and an optional,
// user-configurable reminder to back up periodically (FR-042).
export function BackupSettingsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();
	const native = isNativeApp();

	const [creating, setCreating] = useState(false);
	const [autoBackup, setAutoBackup] = useState<BackupReminderSettings>(loadBackupReminderSettings);
	const [backupPin, setBackupPin] = useState('');
	const [restorePin, setRestorePin] = useState('');
	const [restoring, setRestoring] = useState(false);
	const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
	const [confirmWord, setConfirmWord] = useState('');
	const [clearAllOpen, setClearAllOpen] = useState(false);
	const [clearAllConfirm, setClearAllConfirm] = useState('');
	const [clearing, setClearing] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// spec 019, User Story 7 (P4): scheduled local encrypted backups — distinct from the
	// existing `autoBackup` state above, which is only a UI "remind me" preference and never
	// writes a file itself.
	const [scheduled, setScheduled] = useState<ScheduledBackupSettings | null>(null);
	const [choosingFolder, setChoosingFolder] = useState(false);
	const scheduledSupported = isAutoBackupSupported();

	useEffect(() => {
		saveBackupReminderSettings(autoBackup);
	}, [autoBackup]);

	async function handleReminderToggle(enabled: boolean) {
		const next = { ...autoBackup, enabled };
		setAutoBackup(next);
		// Saved before the OS schedule is synced: `syncBackupReminder` reads the saved preference.
		saveBackupReminderSettings(next);
		if (!enabled) {
			await syncBackupReminder();
			return;
		}
		const canNotify = await enableBackupReminder();
		if (!canNotify) {
			toast.info(
				'Notifications are off for MyFin, so the reminder will only show here and on the Dashboard.'
			);
		}
	}

	useEffect(() => {
		void AutoBackupSettingsRepository.get()
			.then(setScheduled)
			.catch(() => {});
	}, []);

	async function handleChooseScheduledFolder(intervalDays: number) {
		setChoosingFolder(true);
		try {
			if (usesNativeBackupFolder()) {
				const nativeFolder = await requestNativeBackupFolder();
				await configureAutoBackup({ enabled: true, intervalDays, nativeFolder });
			} else {
				const directoryHandle = await requestBackupFolder();
				await configureAutoBackup({ enabled: true, intervalDays, directoryHandle });
			}
			setScheduled(await AutoBackupSettingsRepository.get());
			toast.success('Automatic backups enabled');
		} catch (err) {
			// The user cancelling the folder picker throws too — not a real error.
			if (isFolderPickCancelled(err)) return;
			if (err instanceof Error && err.name !== 'AbortError') {
				toast.error(err.message);
			}
		} finally {
			setChoosingFolder(false);
		}
	}

	async function updateScheduled(changes: { enabled?: boolean; intervalDays?: number }) {
		if (!scheduled) return;
		try {
			await configureAutoBackup({
				enabled: changes.enabled ?? scheduled.enabled,
				intervalDays: changes.intervalDays ?? scheduled.intervalDays,
				directoryHandle: scheduled.directoryHandle,
				nativeFolder: scheduled.nativeFolder
			});
			setScheduled(await AutoBackupSettingsRepository.get());
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not update automatic backups.');
		}
	}

	const daysSince = daysSinceLastBackup(autoBackup, scheduled?.lastBackupAt);
	const overdue = autoBackup.enabled && isBackupOverdue(daysSince);

	/**
	 * Requires the PIN even though the session is already unlocked. A backup is the one
	 * artifact that leaves the device, so it is encrypted under a key derived at the much
	 * higher backup iteration count — which needs the PIN, not the session key. Verifying it
	 * first also means a typo can't produce a file the user is then unable to open. The attempt
	 * counts toward the same lockout as the lock screen.
	 */
	async function handleCreateBackup() {
		setCreating(true);
		try {
			const check = await checkPinWithThrottle(backupPin);
			if (!check.ok) {
				toast.error(check.message);
				return;
			}
			const { profile } = check;

			const backup = await createBackup(key, profile.encryptionSalt, backupPin);
			// Prove the file can be opened with this PIN before it is handed over: a backup nobody
			// can read is worse than none, because it is trusted.
			await validateAndDecryptBackup(backup, backupPin);

			const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
			await saveFile(blob, `myfin-backup-${todayLocalISO()}.json`);
			recordManualBackup();
			setAutoBackup(loadBackupReminderSettings());
			void syncBackupReminder();
			setBackupPin('');
			toast.success(
				native
					? 'Backup file created. Check it reached Drive or Files — MyFin cannot see where it went.'
					: 'Backup created'
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not create backup.');
		} finally {
			setCreating(false);
		}
	}

	/**
	 * Decrypts and validates, then stops and asks. Nothing is written here — the restore only
	 * commits from the confirmation dialog, which can state exactly what is about to be lost
	 * and gained because the payload has already been read.
	 */
	async function handleRestoreFile(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (fileInputRef.current) fileInputRef.current.value = '';
		if (!file) return;
		// Not the current PIN policy's floor: this is the PIN the *backup* was made with, and
		// an older backup may predate the current minimum length.
		if (!/^\d{4,32}$/.test(restorePin)) {
			toast.error('Enter the PIN this backup was created with.');
			return;
		}
		if (file.size > MAX_RESTORE_FILE_BYTES) {
			toast.error(
				`That file is ${(file.size / (1024 * 1024)).toFixed(0)} MB, which is too large to be a MyFin backup.`
			);
			return;
		}

		setRestoring(true);
		try {
			const parsedFile = JSON.parse(await file.text()) as BackupFile;
			const { payload } = await validateAndDecryptBackup(parsedFile, restorePin);
			setConfirmWord('');
			setPendingRestore({
				payload,
				pin: restorePin,
				fallbackSalt: parsedFile.kdf.salt,
				incomingCount: payload.exportedEntities.transactions.length,
				currentCount: await TransactionRepository.count(),
				createdAt: parsedFile.createdAt
			});
		} catch (err) {
			const message =
				err instanceof BackupValidationError ? err.message : 'Could not read this backup file.';
			toast.error(message);
		} finally {
			setRestoring(false);
		}
	}

	async function commitRestore() {
		if (!pendingRestore) return;
		setRestoring(true);
		try {
			// The database is re-encrypted under the *interactive* key, not the backup key —
			// LockScreen re-derives at the interactive cost on every unlock, and using the
			// backup key here would leave nothing able to decrypt the restored data.
			const dataKey = await deriveDataKeyForPayload(
				pendingRestore.payload,
				pendingRestore.pin,
				pendingRestore.fallbackSalt
			);
			await restoreBackup(dataKey, pendingRestore.payload);
			setPendingRestore(null);
			toast.success('Backup restored. Reloading…');
			window.location.reload();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not restore this backup file.');
		} finally {
			setRestoring(false);
		}
	}

	async function handleClearAll() {
		setClearing(true);
		try {
			await resetEverything();
			toast.success('All data cleared. Reloading…');
			window.location.reload();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not clear data.');
			setClearing(false);
		}
	}

	return (
		<div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">Backup &amp; Restore</h1>

			{overdue && (
				<Alert className="mb-6">
					<ShieldAlert />
					<AlertTitle>Time for a backup</AlertTitle>
					<AlertDescription>
						{daysSince === null
							? 'You have not made a backup yet.'
							: `It's been ${daysSince} days since your last backup.`}{' '}
						Create one below to keep your data safe.
					</AlertDescription>
				</Alert>
			)}

			<Card className="mb-6">
				<CardHeader>
					<CardTitle className="text-base">Create backup</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<p className="text-sm text-muted-foreground">
						{native
							? 'Creates a single encrypted file containing your entire local database and opens the share sheet so you can save it to Drive, Files or send it to yourself. '
							: 'Downloads a single encrypted file containing your entire local database. '}
						Your PIN is the only thing that can open it — if you lose the PIN, the backup is
						unreadable.
					</p>
					{native && (
						<p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-muted-foreground">
							MyFin keeps your data only on this phone. Uninstalling the app, clearing its storage
							or changing phones erases it, and Android does not back it up for you — a saved backup
							file is the only copy.
						</p>
					)}
					<p className="text-sm">{describeLastBackup(daysSince)}</p>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="backup-pin">Confirm your PIN</Label>
						<Input
							id="backup-pin"
							type="password"
							inputMode="numeric"
							autoComplete="current-password"
							value={backupPin}
							onChange={(e) => setBackupPin(e.target.value)}
							disabled={creating}
						/>
					</div>
					<Button
						type="button"
						disabled={creating || !backupPin}
						onClick={handleCreateBackup}
						className="w-fit"
					>
						<DatabaseBackup /> {creating ? 'Creating…' : 'Create backup now'}
					</Button>
					<div className="flex items-center justify-between border-t pt-4">
						<div>
							<Label htmlFor="auto-backup">Remind me to back up weekly</Label>
							<p className="text-xs text-muted-foreground">
								{native
									? `Sends a notification (with no financial details) when it has been ${BACKUP_REMINDER_INTERVAL_DAYS} days or more, and shows a reminder on the Dashboard.`
									: `Shows a reminder on the Dashboard and here when it has been ${BACKUP_REMINDER_INTERVAL_DAYS} days or more.`}
							</p>
						</div>
						<Switch
							id="auto-backup"
							checked={autoBackup.enabled}
							onCheckedChange={(enabled) => void handleReminderToggle(enabled)}
						/>
					</div>
				</CardContent>
			</Card>

			<Card className="mb-6">
				<CardHeader>
					<CardTitle className="text-base">Automatic backups</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{!scheduledSupported ? (
						<p className="text-sm text-muted-foreground">
							{native
								? 'Saving automatically to a folder needs a newer version of the Android app. Turn on the weekly reminder above and use "Create backup now" for now.'
								: 'Automatic backups aren\'t available in this browser — it doesn\'t support saving directly to a folder on this device. Use "Create backup now" above instead.'}
						</p>
					) : !scheduled?.directoryHandle && !scheduled?.nativeFolder ? (
						<>
							<p className="text-sm text-muted-foreground">
								Automatically save a new encrypted backup to a folder on this device, checked each
								time you unlock the app.
								{native &&
									' Pick a folder your cloud storage or sync app already watches (for example one inside Documents) and the backups leave the phone on their own.'}
							</p>
							<Button
								type="button"
								variant="outline"
								className="w-fit"
								disabled={choosingFolder}
								onClick={() => void handleChooseScheduledFolder(7)}
							>
								{choosingFolder ? 'Choosing…' : 'Choose backup folder'}
							</Button>
						</>
					) : (
						<>
							<div className="flex items-center justify-between">
								<div>
									<Label htmlFor="scheduled-backup-enabled">Enabled</Label>
									<p className="text-xs text-muted-foreground">
										Checked automatically on each unlock.
									</p>
								</div>
								<Switch
									id="scheduled-backup-enabled"
									checked={scheduled.enabled}
									onCheckedChange={(enabled) => void updateScheduled({ enabled })}
								/>
							</div>
							<div className="flex flex-col gap-1.5">
								<Label htmlFor="scheduled-backup-interval">Interval</Label>
								<Select
									value={String(scheduled.intervalDays)}
									onValueChange={(v) => void updateScheduled({ intervalDays: Number(v) })}
								>
									<SelectTrigger id="scheduled-backup-interval" className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="1">Daily</SelectItem>
										<SelectItem value="7">Weekly</SelectItem>
										<SelectItem value="30">Monthly</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<p className="text-sm text-muted-foreground">
								{scheduled.nativeFolder && (
									<>
										Saving to <strong>{scheduled.nativeFolder.name}</strong>.{' '}
									</>
								)}
								Each backup is a new file. The newest {KEEP_AUTO_BACKUPS} are kept and older
								automatic backups are removed; other files in the folder are never touched.
							</p>
							<p className="text-sm text-muted-foreground">
								{scheduled.lastBackupAt
									? `Last successful backup: ${formatBackupDate(scheduled.lastBackupAt)}`
									: 'No automatic backup has run yet.'}
							</p>
							{scheduled.lastBackupStatus === 'failed' && (
								<Alert variant="destructive">
									<ShieldAlert />
									<AlertTitle>Last automatic backup failed</AlertTitle>
									<AlertDescription>
										Check that this app still has permission to write to the chosen folder, or
										choose a new one.
									</AlertDescription>
								</Alert>
							)}
							<Button
								type="button"
								variant="outline"
								className="w-fit"
								disabled={choosingFolder}
								onClick={() => void handleChooseScheduledFolder(scheduled.intervalDays)}
							>
								{choosingFolder ? 'Choosing…' : 'Change folder'}
							</Button>
						</>
					)}
				</CardContent>
			</Card>

			<DataIntegrityCard />

			<Card className="mb-6">
				<CardHeader>
					<CardTitle className="text-base">Restore from backup</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<p className="text-sm text-muted-foreground">
						Restoring replaces everything currently in this app with the contents of the backup
						file. You'll see what will change before anything is written. Enter the PIN the backup
						was made with, then choose the file.
					</p>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="restore-pin">Backup PIN</Label>
						<Input
							id="restore-pin"
							type="password"
							inputMode="numeric"
							value={restorePin}
							onChange={(e) => setRestorePin(e.target.value)}
						/>
					</div>
					<Button
						type="button"
						variant="destructive"
						disabled={restoring || !restorePin}
						onClick={() => fileInputRef.current?.click()}
						className="w-fit"
					>
						<Upload /> {restoring ? 'Reading backup…' : 'Choose backup file…'}
					</Button>
					<input
						ref={fileInputRef}
						type="file"
						accept=".json,application/json"
						className="hidden"
						onChange={(e) => void handleRestoreFile(e)}
					/>
				</CardContent>
			</Card>

			{/* Clear All Data (spec 016, FR-013/014) */}
			<Card className="border-destructive/50">
				<CardHeader>
					<CardTitle className="text-base text-destructive">Clear all data</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<p className="text-sm text-muted-foreground">
						Permanently delete all your financial data (accounts, transactions, budgets,
						investments, categories, tags, recurring rules) <strong>and</strong> your PIN/security
						setup and app preferences. The app will restart in first-run/onboarding mode. This
						cannot be undone — create a backup first if there is anything you want to keep.
					</p>
					<Button
						type="button"
						variant="destructive"
						onClick={() => {
							setClearAllConfirm('');
							setClearAllOpen(true);
						}}
						className="w-fit"
					>
						<Trash2 /> Clear all data
					</Button>
				</CardContent>
			</Card>

			<Dialog
				open={!!pendingRestore}
				onOpenChange={(open) => {
					if (!open) setPendingRestore(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Replace all data on this device?</DialogTitle>
						<DialogDescription>
							{pendingRestore && (
								<>
									This replaces the {pendingRestore.currentCount.toLocaleString()} transaction
									{pendingRestore.currentCount === 1 ? '' : 's'} currently on this device with{' '}
									{pendingRestore.incomingCount.toLocaleString()} from a backup made on{' '}
									{formatBackupDate(pendingRestore.createdAt)}. Everything here now — accounts,
									budgets, goals, attachments — is permanently deleted. This cannot be undone.
									<br />
									<br />
									<strong>Your PIN also changes</strong> to the one the backup was made with, and
									fingerprint unlock and the auto-lock settings revert to what they were then. You
									will be asked to unlock again right after.
								</>
							)}
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="restore-confirm">Type {RESTORE_CONFIRM_WORD} to confirm</Label>
						<Input
							id="restore-confirm"
							value={confirmWord}
							onChange={(e) => setConfirmWord(e.target.value)}
							autoComplete="off"
						/>
					</div>
					<div className="flex flex-wrap justify-end gap-2">
						<Button variant="outline" onClick={() => setPendingRestore(null)} disabled={restoring}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={restoring || confirmWord !== RESTORE_CONFIRM_WORD}
							onClick={() => void commitRestore()}
						>
							{restoring ? 'Restoring…' : 'Replace everything'}
						</Button>
					</div>
				</DialogContent>
			</Dialog>

			{/* Clear All Data confirmation dialog (spec 016, FR-014) */}
			<Dialog open={clearAllOpen} onOpenChange={setClearAllOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Clear all data?</DialogTitle>
						<DialogDescription>
							This will permanently delete <strong>all</strong> your financial data (accounts,
							transactions, budgets, investments, categories, tags, recurring rules){' '}
							<strong>and your PIN/security setup and preferences</strong>. The app will restart
							from scratch requiring a new PIN. This cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="clear-all-confirm">
							Type <span className="font-mono font-bold">{CLEAR_ALL_CONFIRM_WORD}</span> to confirm
						</Label>
						<Input
							id="clear-all-confirm"
							value={clearAllConfirm}
							onChange={(e) => setClearAllConfirm(e.target.value)}
							autoComplete="off"
						/>
					</div>
					<div className="flex flex-wrap justify-end gap-2">
						<Button variant="outline" onClick={() => setClearAllOpen(false)} disabled={clearing}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={clearing || clearAllConfirm !== CLEAR_ALL_CONFIRM_WORD}
							onClick={() => void handleClearAll()}
						>
							{clearing ? 'Clearing…' : 'Clear everything'}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
