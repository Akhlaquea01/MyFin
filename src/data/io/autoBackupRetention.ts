// Scheduled backups used to pile up forever, one file per run. After each successful run the
// folder is trimmed to the newest few. Only MyFin's own file names are ever considered, so
// anything else the user keeps in that folder is never touched.

/** How many automatic backups stay in the folder. Ten weekly runs is about two and a half months. */
export const KEEP_AUTO_BACKUPS = 10;

const AUTO_BACKUP_FILE = /^myfin-auto-backup-\d{4}-\d{2}-\d{2}\.json$/;

export function isAutoBackupFile(name: string): boolean {
	return AUTO_BACKUP_FILE.test(name);
}

/**
 * Which of `names` to delete: the automatic backups beyond the newest `keep` (the date in the name
 * sorts as text). `protect`ed names are never returned, so the file just written survives even if
 * the device clock has been set back and older-looking dates outrank it.
 */
export function selectBackupsToDelete(
	names: string[],
	protect: string[] = [],
	keep: number = KEEP_AUTO_BACKUPS
): string[] {
	return names
		.filter(isAutoBackupFile)
		.sort()
		.reverse()
		.slice(keep)
		.filter((name) => !protect.includes(name));
}
