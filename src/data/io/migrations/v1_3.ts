import type { BackupPayload } from '../backupService';

/**
 * Migrates a v1.3.0 payload forward to v1.4.0: spec 010 (lending/borrowing) and spec 013
 * (saved transaction filter views) added people/loans/repayments/saved views to db.ts after
 * v1.3.0 shipped, so a backup made before that exists simply has no data for them — default
 * to empty (contracts/backup-format.md's "Compatibility policy": migrations are
 * additive/forward only).
 */
export function migrateFromV1_3(payload: BackupPayload): BackupPayload {
	return {
		...payload,
		exportedEntities: {
			...payload.exportedEntities,
			people: payload.exportedEntities.people ?? [],
			personLoans: payload.exportedEntities.personLoans ?? [],
			personLoanRepayments: payload.exportedEntities.personLoanRepayments ?? [],
			savedFilterViews: payload.exportedEntities.savedFilterViews ?? []
		}
	};
}
