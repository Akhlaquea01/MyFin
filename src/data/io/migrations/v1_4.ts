import type { BackupPayload } from '../backupService';
import { dropTrashed } from './dropTrashed';

/**
 * Migrates a v1.4.0 payload forward to v1.5.0: deletes became permanent, so whatever the backup
 * held in Trash is dropped along with what hung off it (contracts/backup-format.md's
 * "Compatibility policy").
 */
export function migrateFromV1_4(payload: BackupPayload): BackupPayload {
	return dropTrashed(payload);
}
