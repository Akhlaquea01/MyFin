import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	BACKUP_REMINDER_INTERVAL_DAYS,
	daysSinceLastBackup,
	isBackupOverdue,
	loadBackupReminderSettings,
	recordManualBackup,
	saveBackupReminderSettings
} from '../../src/lib/backupReminder';
import { nextReminderTime } from '../../src/data/io/backupReminderService';
import {
	isBiometricPromptSnoozed,
	snoozeBiometricPrompt
} from '../../src/lib/biometricPromptSnooze';
import { clearSetupStorage, safeGetItem, safeSetItem } from '../../src/lib/safeStorage';

// The node test environment has no localStorage; a Map-backed stand-in is enough for key/value use.
function stubLocalStorage() {
	const store = new Map<string, string>();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, String(v)),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear()
	});
}

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-12T10:00:00Z').getTime();

describe('daysSinceLastBackup / isBackupOverdue', () => {
	it('is null when there has never been a backup, and that counts as overdue', () => {
		const days = daysSinceLastBackup({ enabled: false, lastBackupAt: null }, null, now);
		expect(days).toBeNull();
		expect(isBackupOverdue(days)).toBe(true);
	});

	it('counts whole days since a manual backup', () => {
		expect(
			daysSinceLastBackup({ enabled: true, lastBackupAt: now - 3 * DAY - 1000 }, null, now)
		).toBe(3);
	});

	it('uses whichever of the manual and scheduled backups is newer', () => {
		const scheduled = new Date(now - 1 * DAY).toISOString();
		expect(
			daysSinceLastBackup({ enabled: true, lastBackupAt: now - 20 * DAY }, scheduled, now)
		).toBe(1);
		const oldScheduled = new Date(now - 30 * DAY).toISOString();
		expect(
			daysSinceLastBackup({ enabled: true, lastBackupAt: now - 2 * DAY }, oldScheduled, now)
		).toBe(2);
	});

	it('ignores a scheduled timestamp that does not parse', () => {
		expect(
			daysSinceLastBackup({ enabled: true, lastBackupAt: now - 2 * DAY }, 'garbage', now)
		).toBe(2);
	});

	it('is overdue exactly at the reminder interval, not before', () => {
		expect(isBackupOverdue(BACKUP_REMINDER_INTERVAL_DAYS - 1)).toBe(false);
		expect(isBackupOverdue(BACKUP_REMINDER_INTERVAL_DAYS)).toBe(true);
	});
});

describe('backup reminder settings storage', () => {
	beforeEach(stubLocalStorage);

	it('round-trips, and recordManualBackup keeps the reminder preference', () => {
		saveBackupReminderSettings({ enabled: true, lastBackupAt: null });
		recordManualBackup(1234);
		expect(loadBackupReminderSettings()).toEqual({ enabled: true, lastBackupAt: 1234 });
	});

	it('survives corrupt storage', () => {
		localStorage.setItem('myfin.autoBackup', '{not json');
		expect(loadBackupReminderSettings()).toEqual({ enabled: false, lastBackupAt: null });
	});
});

describe('nextReminderTime', () => {
	it('is a week after the last backup when that is still ahead', () => {
		expect(nextReminderTime(now - 2 * DAY, now)).toBe(now + 5 * DAY);
	});

	it('is tomorrow when the backup is already overdue', () => {
		expect(nextReminderTime(now - 30 * DAY, now)).toBe(now + DAY);
	});

	it('is tomorrow when there has never been a backup, rather than a week away', () => {
		expect(nextReminderTime(null, now)).toBe(now + DAY);
	});
});

describe('biometric prompt snooze and safe storage', () => {
	beforeEach(stubLocalStorage);

	it('is not snoozed until the user declines, then stays snoozed for a long while', () => {
		expect(isBiometricPromptSnoozed(now)).toBe(false);
		snoozeBiometricPrompt(now);
		expect(isBiometricPromptSnoozed(now + 10 * DAY)).toBe(true);
		expect(isBiometricPromptSnoozed(now + 31 * DAY)).toBe(false);
	});

	it('clearSetupStorage forgets the per-device setup flags', () => {
		safeSetItem('APP_QUICK_TOUR_SEEN', 'true');
		snoozeBiometricPrompt(now);
		clearSetupStorage();
		expect(safeGetItem('APP_QUICK_TOUR_SEEN')).toBeNull();
		expect(isBiometricPromptSnoozed(now)).toBe(false);
	});
});
