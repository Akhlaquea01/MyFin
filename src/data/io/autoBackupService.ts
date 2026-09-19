import { AutoBackupSettingsRepository } from '../dexie/autoBackupSettingsRepository';
import { createBackup } from './backupService';
import type { UserProfile } from '../../domain/entities';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Feature-detects the File System Access API (Chromium-only today — Safari/iOS and Firefox
 *  don't implement it), gating the whole automatic-backup UI/flow honestly rather than failing
 *  later at write time (FR-028, research.md R5). */
export function isAutoBackupSupported(): boolean {
	return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** Opens the browser's native folder picker for the user to choose a backup destination. */
export async function requestBackupFolder(): Promise<FileSystemDirectoryHandle> {
	if (!isAutoBackupSupported()) {
		throw new Error('Automatic backups are not supported in this browser.');
	}
	return window.showDirectoryPicker({ mode: 'readwrite' });
}

export async function configureAutoBackup(settings: {
	enabled: boolean;
	intervalDays: number;
	directoryHandle?: FileSystemDirectoryHandle;
}): Promise<void> {
	await AutoBackupSettingsRepository.update(settings);
}

function backupFilename(now: Date): string {
	return `myfin-auto-backup-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Runs a scheduled backup when due (FR-026, contracts/scheduled-backup.md). MUST be called only
 * from the unlock callback (`LockScreen`'s `onunlock(pin)`, wired in App.tsx) — `pin` is
 * required to derive the same higher-cost backup encryption key `createBackup()` already uses
 * for manual exports, and the unlock callback is the only moment the plaintext PIN exists in
 * memory at all, since it is never stored (Constitution Principle II; research.md R5).
 *
 * Idempotent no-op when disabled, unsupported, no folder configured, or not yet due — safe to
 * call unconditionally on every unlock.
 */
export async function maybeRunScheduledBackup(
	pin: string,
	key: CryptoKey,
	profile: UserProfile
): Promise<void> {
	if (!isAutoBackupSupported()) return;

	const settings = await AutoBackupSettingsRepository.get();
	if (!settings.enabled || !settings.directoryHandle) return;

	const lastBackupAtMs = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : 0;
	const dueAtMs = lastBackupAtMs + settings.intervalDays * DAY_MS;
	if (Date.now() < dueAtMs) return;

	try {
		const handle = settings.directoryHandle;
		const existing = await handle.queryPermission({ mode: 'readwrite' });
		const granted =
			existing === 'granted' || (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
		if (!granted) throw new Error('Folder access permission was not granted.');

		// Same, unmodified encrypted payload the manual export flow already produces (FR-027) —
		// this module never constructs its own serialization of financial data.
		const backup = await createBackup(key, profile.encryptionSalt, pin);

		const now = new Date();
		const fileHandle = await handle.getFileHandle(backupFilename(now), { create: true });
		// createWritable()/write()/close() replaces the target file only on a fully successful
		// close() — a failure mid-write never leaves a corrupted file visible under the final
		// filename (Constitution Principle VI).
		const writable = await fileHandle.createWritable();
		await writable.write(JSON.stringify(backup));
		await writable.close();

		await AutoBackupSettingsRepository.update({
			lastBackupAt: now.toISOString(),
			lastBackupStatus: 'success'
		});
	} catch {
		// Never touches existing data or any previously-written backup file — only records the
		// failure so BackupSettingsPage can surface it (FR-030).
		await AutoBackupSettingsRepository.update({ lastBackupStatus: 'failed' });
	}
}
