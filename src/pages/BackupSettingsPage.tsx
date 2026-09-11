import { useEffect, useRef, useState } from 'react';
import { saveAs } from 'file-saver';
import { DatabaseBackup, ShieldAlert, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle
} from '../components/ui/dialog';
import { useSession } from '../context/SessionContext';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';
import { TransactionRepository } from '../data/dexie/transactionRepository';
import { verifyPin } from '../data/crypto/cryptoService';
import {
	createBackup,
	validateAndDecryptBackup,
	deriveDataKeyForPayload,
	restoreBackup,
	BackupValidationError,
	type BackupFile,
	type BackupPayload
} from '../data/io/backupService';

const AUTO_BACKUP_KEY = 'myfin.autoBackup';
const REMINDER_INTERVAL_DAYS = 7;
/** Typed by the user to arm the restore. Deliberately not a plain "Yes" — this wipes
 *  everything and cannot be undone (Constitution Principle VI). */
const RESTORE_CONFIRM_WORD = 'REPLACE';

interface AutoBackupSettings {
	enabled: boolean;
	lastBackupAt: number | null;
}

interface PendingRestore {
	payload: BackupPayload;
	pin: string;
	fallbackSalt: string;
	incomingCount: number;
	currentCount: number;
	createdAt: string;
}

function loadAutoBackupSettings(): AutoBackupSettings {
	try {
		const raw = localStorage.getItem(AUTO_BACKUP_KEY);
		if (!raw) return { enabled: false, lastBackupAt: null };
		return JSON.parse(raw) as AutoBackupSettings;
	} catch {
		return { enabled: false, lastBackupAt: null };
	}
}

function saveAutoBackupSettings(settings: AutoBackupSettings) {
	try {
		localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(settings));
	} catch {
		// Best-effort only: a UI reminder preference, not financial data.
	}
}

function formatBackupDate(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? 'an unknown date' : date.toLocaleDateString();
}

// User Story 9 (P9): create/restore encrypted backups (FR-040-FR-043) and an optional,
// user-configurable reminder to back up periodically (FR-042).
export function BackupSettingsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [creating, setCreating] = useState(false);
	const [autoBackup, setAutoBackup] = useState<AutoBackupSettings>(loadAutoBackupSettings);
	const [backupPin, setBackupPin] = useState('');
	const [restorePin, setRestorePin] = useState('');
	const [restoring, setRestoring] = useState(false);
	const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
	const [confirmWord, setConfirmWord] = useState('');
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		saveAutoBackupSettings(autoBackup);
	}, [autoBackup]);

	const overdue =
		autoBackup.enabled &&
		(!autoBackup.lastBackupAt ||
			Date.now() - autoBackup.lastBackupAt > REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

	/**
	 * Requires the PIN even though the session is already unlocked. A backup is the one
	 * artifact that leaves the device, so it is encrypted under a key derived at the much
	 * higher backup iteration count — which needs the PIN, not the session key. Verifying it
	 * first also means a typo can't produce a file the user is then unable to open.
	 */
	async function handleCreateBackup() {
		setCreating(true);
		try {
			const profile = await UserProfileRepository.get();
			if (!profile) throw new Error('No profile found.');

			const correct = await verifyPin(backupPin, profile.pinSalt, profile.pinVerifierHash);
			if (!correct) {
				toast.error('Incorrect PIN.');
				return;
			}

			const backup = await createBackup(key, profile.encryptionSalt, backupPin);
			const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
			const date = new Date().toISOString().slice(0, 10);
			saveAs(blob, `myfin-backup-${date}.json`);
			setAutoBackup((s) => ({ ...s, lastBackupAt: Date.now() }));
			setBackupPin('');
			toast.success('Backup created');
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

		setRestoring(true);
		try {
			const parsedFile = JSON.parse(await file.text()) as BackupFile;
			const { payload } = await validateAndDecryptBackup(parsedFile, restorePin);
			const profile = await UserProfileRepository.get();
			setConfirmWord('');
			setPendingRestore({
				payload,
				pin: restorePin,
				fallbackSalt: parsedFile.kdf.salt,
				incomingCount: payload.exportedEntities.transactions.length,
				currentCount: await TransactionRepository.countActive(),
				createdAt: parsedFile.createdAt
			});
			void profile;
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

	return (
		<div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">Backup &amp; Restore</h1>

			{overdue && (
				<Alert className="mb-6">
					<ShieldAlert />
					<AlertTitle>Time for a backup</AlertTitle>
					<AlertDescription>
						It's been over a week since your last backup. Create one below to keep your data safe.
					</AlertDescription>
				</Alert>
			)}

			<Card className="mb-6">
				<CardHeader>
					<CardTitle className="text-base">Create backup</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<p className="text-sm text-muted-foreground">
						Downloads a single encrypted file containing your entire local database. Your PIN is the
						only thing that can open it — if you lose the PIN, the backup is unreadable.
					</p>
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
								Shows a reminder here if it's been a while since your last backup.
							</p>
						</div>
						<Switch
							id="auto-backup"
							checked={autoBackup.enabled}
							onCheckedChange={(enabled) => setAutoBackup((s) => ({ ...s, enabled }))}
						/>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-base">Restore from backup</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					<p className="text-sm text-muted-foreground">
						Restoring replaces everything currently in this app with the contents of the backup
						file. You'll see what will change before anything is written.
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
						<Upload /> {restoring ? 'Reading…' : 'Choose backup file…'}
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
		</div>
	);
}
