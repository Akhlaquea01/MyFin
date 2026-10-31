import { describe, expect, it } from 'vitest';
import {
	KEEP_AUTO_BACKUPS,
	isAutoBackupFile,
	selectBackupsToDelete
} from '../../src/data/io/autoBackupRetention';

const backup = (day: number) => `myfin-auto-backup-2026-03-${String(day).padStart(2, '0')}.json`;
const days = (n: number) => Array.from({ length: n }, (_, i) => backup(i + 1));

describe('isAutoBackupFile', () => {
	it('accepts only the exact scheduled-backup file name', () => {
		expect(isAutoBackupFile('myfin-auto-backup-2026-03-05.json')).toBe(true);
		for (const other of [
			'myfin-backup-2026-03-05.json',
			'myfin-auto-backup-2026-03-05.json.bak',
			'myfin-auto-backup-2026-03-05 (1).json',
			'../myfin-auto-backup-2026-03-05.json',
			'notes.txt',
			''
		]) {
			expect(isAutoBackupFile(other)).toBe(false);
		}
	});
});

describe('selectBackupsToDelete', () => {
	it('deletes nothing while the folder holds no more than the limit', () => {
		expect(selectBackupsToDelete(days(KEEP_AUTO_BACKUPS))).toEqual([]);
		expect(selectBackupsToDelete([])).toEqual([]);
	});

	it('deletes the oldest backups beyond the newest ones, whatever order they are listed in', () => {
		const listed = days(KEEP_AUTO_BACKUPS + 3).reverse();
		expect(selectBackupsToDelete(listed).sort()).toEqual([backup(1), backup(2), backup(3)]);
	});

	it('never selects a file that is not one of its own backups', () => {
		const names = [
			...days(KEEP_AUTO_BACKUPS + 1),
			'notes.txt',
			'myfin-auto-backup-2026-03-01 (1).json'
		];
		expect(selectBackupsToDelete(names)).toEqual([backup(1)]);
	});

	it('spares a protected file even when it sorts as old, such as after the clock was set back', () => {
		expect(selectBackupsToDelete(days(KEEP_AUTO_BACKUPS + 2), [backup(1)])).toEqual([backup(2)]);
	});

	it('honours a different limit', () => {
		expect(selectBackupsToDelete(days(4), [], 2)).toEqual([backup(2), backup(1)]);
	});
});
