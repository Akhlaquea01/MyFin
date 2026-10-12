// "When did I last back up?" — kept in localStorage because it is a per-device nudge, not data.
// Shared by the Backup page, the Dashboard's backup nudge and the unlock-time reminder, so all
// three agree on what counts as "overdue".
import { safeGetItem, safeSetItem } from './safeStorage';

export const AUTO_BACKUP_KEY = 'myfin.autoBackup';
export const BACKUP_REMINDER_INTERVAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface BackupReminderSettings {
	/** The user asked to be reminded weekly. */
	enabled: boolean;
	/** Epoch ms of the last manual backup this device made. */
	lastBackupAt: number | null;
}

export function loadBackupReminderSettings(): BackupReminderSettings {
	try {
		const raw = safeGetItem(AUTO_BACKUP_KEY);
		if (!raw) return { enabled: false, lastBackupAt: null };
		const parsed = JSON.parse(raw) as Partial<BackupReminderSettings>;
		return {
			enabled: !!parsed.enabled,
			lastBackupAt: typeof parsed.lastBackupAt === 'number' ? parsed.lastBackupAt : null
		};
	} catch {
		return { enabled: false, lastBackupAt: null };
	}
}

export function saveBackupReminderSettings(settings: BackupReminderSettings): void {
	safeSetItem(AUTO_BACKUP_KEY, JSON.stringify(settings));
}

/** Notes that a backup file was just made, keeping the reminder preference as it was. */
export function recordManualBackup(now: number = Date.now()): void {
	const current = loadBackupReminderSettings();
	saveBackupReminderSettings({ ...current, lastBackupAt: now });
}

/**
 * Whole days since the most recent backup of either kind (a manual file or a scheduled folder
 * backup), or null if there has never been one.
 */
export function daysSinceLastBackup(
	settings: BackupReminderSettings,
	scheduledLastBackupAt: string | null | undefined,
	now: number = Date.now()
): number | null {
	const scheduled = scheduledLastBackupAt ? Date.parse(scheduledLastBackupAt) : NaN;
	const times = [settings.lastBackupAt, Number.isNaN(scheduled) ? null : scheduled].filter(
		(t): t is number => t !== null
	);
	if (times.length === 0) return null;
	return Math.max(0, Math.floor((now - Math.max(...times)) / DAY_MS));
}

/** Whether a backup is overdue: never made, or older than the reminder interval. */
export function isBackupOverdue(days: number | null): boolean {
	return days === null || days >= BACKUP_REMINDER_INTERVAL_DAYS;
}
