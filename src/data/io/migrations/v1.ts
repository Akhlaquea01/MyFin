import type { BackupPayload } from '../backupService';

/**
 * Migrates a v1.0.0 payload forward to the current shape. Specs 002-006 added the debt
 * payoff planner preference, savings goals/contributions, notification preference/dedupe,
 * attachments, and auto-categorization tables to db.ts after v1.0.0 shipped, so a backup
 * made before this migration existed simply has no data for them — default to empty
 * (contracts/backup-format.md's "Compatibility policy": migrations are additive/forward
 * only; a validated backup is migrated in a single hop, not chained through each
 * intermediate version).
 */
export function migrateFromV1(payload: BackupPayload): BackupPayload {
	return {
		...payload,
		exportedEntities: {
			...payload.exportedEntities,
			debtPlannerPreference: payload.exportedEntities.debtPlannerPreference ?? null,
			savingsGoals: payload.exportedEntities.savingsGoals ?? [],
			goalContributions: payload.exportedEntities.goalContributions ?? [],
			notificationPreference: payload.exportedEntities.notificationPreference ?? null,
			notifiedItems: payload.exportedEntities.notifiedItems ?? [],
			// spec 005: attachments didn't exist yet either.
			attachments: payload.exportedEntities.attachments ?? [],
			// spec 006: nor did auto-categorization rules/learning signals.
			categorizationRules: payload.exportedEntities.categorizationRules ?? [],
			merchantCategorySignals: payload.exportedEntities.merchantCategorySignals ?? []
		}
	};
}
