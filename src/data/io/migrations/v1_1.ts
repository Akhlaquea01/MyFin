import type { BackupPayload } from '../backupService';

/**
 * Migrates a v1.1.0 payload forward to the current shape: specs 005/006 added receipt/photo
 * attachments and auto-categorization rules/learning signals after v1.1.0 shipped, so a
 * backup made before those exist simply has no data for them — default to empty
 * (contracts/backup-format.md's "Compatibility policy": migrations are additive/forward
 * only; a validated backup is migrated in a single hop, not chained through each
 * intermediate version).
 */
export function migrateFromV1_1(payload: BackupPayload): BackupPayload {
	return {
		...payload,
		exportedEntities: {
			...payload.exportedEntities,
			attachments: payload.exportedEntities.attachments ?? [],
			// spec 006: nor did auto-categorization rules/learning signals.
			categorizationRules: payload.exportedEntities.categorizationRules ?? [],
			merchantCategorySignals: payload.exportedEntities.merchantCategorySignals ?? [],
			// spec 010/013: nor did people/loans/repayments or saved filter views.
			people: payload.exportedEntities.people ?? [],
			personLoans: payload.exportedEntities.personLoans ?? [],
			personLoanRepayments: payload.exportedEntities.personLoanRepayments ?? [],
			savedFilterViews: payload.exportedEntities.savedFilterViews ?? []
		}
	};
}
