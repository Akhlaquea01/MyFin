import type { BackupPayload } from '../backupService';

/**
 * Migrates a v1.2.0 payload forward to v1.3.0: spec 006 added auto-categorization rules and
 * the per-merchant learning signal after v1.2.0 shipped, so a backup made before that exists
 * simply has no data for them — default to empty (contracts/backup-format.md's
 * "Compatibility policy": migrations are additive/forward only).
 */
export function migrateFromV1_2(payload: BackupPayload): BackupPayload {
	return {
		...payload,
		exportedEntities: {
			...payload.exportedEntities,
			categorizationRules: payload.exportedEntities.categorizationRules ?? [],
			merchantCategorySignals: payload.exportedEntities.merchantCategorySignals ?? []
		}
	};
}
