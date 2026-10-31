import { AutoBackupSettingsRepository } from '../dexie/autoBackupSettingsRepository';
import { createBackup } from './backupService';
import type { UserProfile } from '../../domain/entities';
import {
	deleteNativeBackupFile,
	isNativeBackupFolderAvailable,
	listNativeBackupFiles,
	nativeBackupFolderHasAccess,
	pickNativeBackupFolder,
	writeNativeBackupFile,
	type NativeBackupFolder
} from '../../lib/native/nativeBackupFolder';
import { selectBackupsToDelete } from './autoBackupRetention';
import { todayLocalISO } from '../../domain/shared/dateMath';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Feature-detects the File System Access API (Chromium-only today — Safari/iOS and Firefox
 *  don't implement it), gating the whole automatic-backup UI/flow honestly rather than failing
 *  later at write time (FR-028, research.md R5). */
function hasFileSystemAccess(): boolean {
	return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** Whether scheduled backups can work here: through the browser's folder API on the web, or
 *  through Android's folder picker in the APK. */
export function isAutoBackupSupported(): boolean {
	return hasFileSystemAccess() || isNativeBackupFolderAvailable();
}

/** True in the Android app, where the folder is chosen through Android's own picker. */
export function usesNativeBackupFolder(): boolean {
	return isNativeBackupFolderAvailable();
}

/** Opens Android's folder picker (APK only). */
export function requestNativeBackupFolder(): Promise<NativeBackupFolder> {
	return pickNativeBackupFolder();
}

/** Opens the browser's native folder picker for the user to choose a backup destination. */
export async function requestBackupFolder(): Promise<FileSystemDirectoryHandle> {
	if (!hasFileSystemAccess()) {
		throw new Error('Automatic backups are not supported in this browser.');
	}
	return window.showDirectoryPicker({ mode: 'readwrite' });
}

export async function configureAutoBackup(settings: {
	enabled: boolean;
	intervalDays: number;
	directoryHandle?: FileSystemDirectoryHandle;
	nativeFolder?: NativeBackupFolder;
}): Promise<void> {
	// Only what was given: an absent folder must not erase the one already chosen.
	const changes: Parameters<typeof AutoBackupSettingsRepository.update>[0] = {
		enabled: settings.enabled,
		intervalDays: settings.intervalDays
	};
	if (settings.directoryHandle) {
		changes.directoryHandle = settings.directoryHandle;
		changes.nativeFolder = undefined;
	}
	if (settings.nativeFolder) {
		changes.nativeFolder = settings.nativeFolder;
		changes.directoryHandle = undefined;
	}
	await AutoBackupSettingsRepository.update(changes);
}

function backupFilename(now: Date): string {
	return `myfin-auto-backup-${todayLocalISO(now)}.json`;
}

/**
 * Trims the folder to the newest automatic backups once a new one is safely written. Housekeeping
 * only: a failure here costs a little disk space, never the backup just made, so it is not
 * reported as one.
 */
async function pruneOldBackups(
	justWritten: string,
	list: () => Promise<string[]>,
	remove: (name: string) => Promise<void>
): Promise<void> {
	try {
		for (const name of selectBackupsToDelete(await list(), [justWritten])) await remove(name);
	} catch {
		// Leave whatever could not be removed for the next run.
	}
}

async function listDirectory(handle: FileSystemDirectoryHandle): Promise<string[]> {
	const names: string[] = [];
	for await (const entry of handle.values()) {
		if (entry.kind === 'file') names.push(entry.name);
	}
	return names;
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
	if (!settings.enabled || (!settings.directoryHandle && !settings.nativeFolder)) return;

	const lastBackupAtMs = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : 0;
	const dueAtMs = lastBackupAtMs + settings.intervalDays * DAY_MS;
	if (Date.now() < dueAtMs) return;

	try {
		if (settings.nativeFolder) {
			await runNativeBackup(settings.nativeFolder, pin, key, profile);
			return;
		}
		const handle = settings.directoryHandle!;
		const existing = await handle.queryPermission({ mode: 'readwrite' });
		const granted =
			existing === 'granted' ||
			(await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
		if (!granted) throw new Error('Folder access permission was not granted.');

		// Same, unmodified encrypted payload the manual export flow already produces (FR-027) —
		// this module never constructs its own serialization of financial data.
		const backup = await createBackup(key, profile.encryptionSalt, pin);

		const now = new Date();
		const filename = backupFilename(now);
		const fileHandle = await handle.getFileHandle(filename, { create: true });
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
		await pruneOldBackups(
			filename,
			() => listDirectory(handle),
			(name) => handle.removeEntry(name)
		);
	} catch {
		// Never touches existing data or any previously-written backup file — only records the
		// failure so BackupSettingsPage can surface it (FR-030).
		await AutoBackupSettingsRepository.update({ lastBackupStatus: 'failed' });
	}
}

/**
 * The Android app's scheduled backup: the same encrypted file, written into the folder the user
 * chose through Android's picker. Fails (and is recorded as failed) if Android no longer lets
 * MyFin write there, rather than silently doing nothing.
 */
async function runNativeBackup(
	folder: NativeBackupFolder,
	pin: string,
	key: CryptoKey,
	profile: UserProfile
): Promise<void> {
	if (!(await nativeBackupFolderHasAccess(folder.uri))) {
		throw new Error('Android no longer lets MyFin write to the backup folder.');
	}
	const backup = await createBackup(key, profile.encryptionSalt, pin);
	const now = new Date();
	const filename = backupFilename(now);
	await writeNativeBackupFile(folder, filename, JSON.stringify(backup));
	await AutoBackupSettingsRepository.update({
		lastBackupAt: now.toISOString(),
		lastBackupStatus: 'success'
	});
	await pruneOldBackups(
		filename,
		() => listNativeBackupFiles(folder),
		(name) => deleteNativeBackupFile(folder, name)
	);
}
