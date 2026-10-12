// Keeps the OS-level weekly backup reminder in step with what the user asked for and with when
// they last backed up. Android app only: a browser or installed PWA cannot fire anything while
// closed, and relies on the Dashboard and Backup page reminders instead.
import { AutoBackupSettingsRepository } from '../dexie/autoBackupSettingsRepository';
import {
	BACKUP_REMINDER_INTERVAL_DAYS,
	loadBackupReminderSettings
} from '../../lib/backupReminder';
import { isNativeApp } from '../../lib/native/platform';
import {
	cancelBackupReminder,
	getNotifyPermission,
	requestNotifyPermission,
	scheduleBackupReminder
} from '../../lib/notify';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When the next reminder should first fire: a week after the last backup of either kind, or —
 * when that moment has already passed (or there has never been a backup) — tomorrow, so an
 * overdue user is nudged soon rather than a week from now.
 */
export function nextReminderTime(lastBackupAt: number | null, now: number): number {
	if (lastBackupAt === null) return now + DAY_MS;
	const due = lastBackupAt + BACKUP_REMINDER_INTERVAL_DAYS * DAY_MS;
	return due > now + 60_000 ? due : now + DAY_MS;
}

/** Schedules or cancels the weekly reminder to match the saved preference. Never throws. */
export async function syncBackupReminder(now: number = Date.now()): Promise<void> {
	if (!isNativeApp()) return;
	try {
		const settings = loadBackupReminderSettings();
		if (!settings.enabled) {
			await cancelBackupReminder();
			return;
		}
		if ((await getNotifyPermission()) !== 'granted') return;
		const scheduled = await AutoBackupSettingsRepository.get().catch(() => null);
		const scheduledAt = scheduled?.lastBackupAt ? Date.parse(scheduled.lastBackupAt) : NaN;
		const last = [settings.lastBackupAt, Number.isNaN(scheduledAt) ? null : scheduledAt]
			.filter((t): t is number => t !== null)
			.sort((a, b) => b - a)[0];
		await scheduleBackupReminder(new Date(nextReminderTime(last ?? null, now)));
	} catch {
		// A reminder is a convenience; it must never get in the way of unlocking.
	}
}

/**
 * Called when the user turns the reminder on. On Android this also asks for notification
 * permission if it has not been asked yet. Resolves whether the OS reminder will actually fire
 * (always true off Android, where only the in-app reminders apply).
 */
export async function enableBackupReminder(): Promise<boolean> {
	if (!isNativeApp()) return true;
	let permission = await getNotifyPermission();
	if (permission === 'default') permission = await requestNotifyPermission();
	await syncBackupReminder();
	return permission === 'granted';
}
