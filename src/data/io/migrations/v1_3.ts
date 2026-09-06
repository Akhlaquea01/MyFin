import type { BackupPayload } from '../backupService';

/**
 * Identity migration for the current schema (contracts/backup-format.md's "Compatibility
 * policy"): '1.3.0' is the current payload shape today, so there is nothing to transform.
 * The next schema bump adds a sibling module here and registers it in `MIGRATIONS` in
 * backupService.ts, taking the payload from this version forward to the next.
 */
export function migrateFromV1_3(payload: BackupPayload): BackupPayload {
	return payload;
}
