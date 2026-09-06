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
import { useSession } from '../context/SessionContext';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';
import {
	createBackup,
	validateAndDecryptBackup,
	restoreBackup,
	BackupValidationError,
	type BackupFile
} from '../data/io/backupService';

const AUTO_BACKUP_KEY = 'myfin.autoBackup';
const REMINDER_INTERVAL_DAYS = 7;

interface AutoBackupSettings {
	enabled: boolean;
	lastBackupAt: number | null;
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

// User Story 9 (P9): create/restore encrypted backups (FR-040-FR-043) and an optional,
// user-configurable reminder to back up periodically (FR-042).
export function BackupSettingsPage() {
	const { getEncryptionKey } = useSession();
	const key = getEncryptionKey();

	const [creating, setCreating] = useState(false);
	const [autoBackup, setAutoBackup] = useState<AutoBackupSettings>(loadAutoBackupSettings);
	const [restorePin, setRestorePin] = useState('');
	const [restoring, setRestoring] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		saveAutoBackupSettings(autoBackup);
	}, [autoBackup]);

	const overdue =
		autoBackup.enabled &&
		(!autoBackup.lastBackupAt ||
			Date.now() - autoBackup.lastBackupAt > REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000);

	async function handleCreateBackup() {
		setCreating(true);
		try {
			const profile = await UserProfileRepository.get();
			if (!profile) throw new Error('No profile found.');
			const backup = await createBackup(key, profile.encryptionSalt);
			const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
			const date = new Date().toISOString().slice(0, 10);
			saveAs(blob, `myfin-backup-${date}.json`);
			setAutoBackup((s) => ({ ...s, lastBackupAt: Date.now() }));
			toast.success('Backup created');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not create backup.');
		} finally {
			setCreating(false);
		}
	}

	async function handleRestoreFile(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;
		if (!/^\d{4,10}$/.test(restorePin)) {
			toast.error('Enter the PIN this backup was created with.');
			if (fileInputRef.current) fileInputRef.current.value = '';
			return;
		}

		setRestoring(true);
		try {
			const parsedFile = JSON.parse(await file.text()) as BackupFile;
			const { payload, key: restoreKey } = await validateAndDecryptBackup(parsedFile, restorePin);
			await restoreBackup(restoreKey, payload);
			toast.success('Backup restored. Reloading…');
			window.location.reload();
		} catch (err) {
			const message =
				err instanceof BackupValidationError ? err.message : 'Could not restore this backup file.';
			toast.error(message);
		} finally {
			setRestoring(false);
			if (fileInputRef.current) fileInputRef.current.value = '';
		}
	}

	return (
		<div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
			<h1 className="mb-6 text-2xl font-semibold tracking-tight">Backup & Restore</h1>

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
						Downloads a single encrypted file containing your entire local database, protected by
						your PIN.
					</p>
					<Button type="button" disabled={creating} onClick={handleCreateBackup} className="w-fit">
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
						file. This cannot be undone.
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
						disabled={restoring}
						onClick={() => fileInputRef.current?.click()}
						className="w-fit"
					>
						<Upload /> {restoring ? 'Restoring…' : 'Choose backup file…'}
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
		</div>
	);
}
