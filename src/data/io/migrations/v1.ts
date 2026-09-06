import type { BackupPayload } from '../backupService';

/**
 * Identity migration for the baseline schema (contracts/backup-format.md's "Compatibility
 * policy"): '1.0.0' is both the oldest and current payload shape today, so there is nothing
 * to transform yet. Future schema bumps add a sibling module here and register it in
 * `MIGRATIONS` in backupService.ts, each one taking the payload from its predecessor
 * version forward to the next.
 */
export function migrateFromV1(payload: BackupPayload): BackupPayload {
	return payload;
}
