import { db } from './db';

/**
 * Clears every Dexie table in one atomic transaction, including `userProfile` and
 * `sessionKeys` — this is what makes the subsequent state a true first-run state (spec 016,
 * FR-013). Extracted from backupService.ts's restoreBackup so both callers share one
 * definition of "every table that must be cleared" (contracts/reset-service.md).
 *
 * Atomic: either every table is cleared or (on error) none are.
 *
 * `includeLocalSettings` also clears the two tables that describe THIS device rather than the
 * user's data — the scheduled-backup configuration (which holds a handle to a folder on this
 * machine) and the backup log. A full reset must clear them: left behind, the next unlock after
 * "Clear everything" could write an encrypted backup of the freshly created data into the old
 * folder, from a configuration the user believed was gone. A backup RESTORE deliberately does not
 * (the default): restoring data onto a device does not change which folder that device backs up
 * to, and a restore's own transaction does not include those tables.
 */
export async function clearAllTables(
	options: { includeLocalSettings?: boolean } = {}
): Promise<void> {
	const localSettings = options.includeLocalSettings
		? [db.autoBackupSettings, db.backupRecords]
		: [];
	await db.transaction(
		'rw',
		[
			db.accounts,
			db.categories,
			db.merchants,
			db.merchantAliases,
			db.tags,
			db.transactions,
			db.transactionSplits,
			db.transactionTags,
			db.budgets,
			db.budgetItems,
			db.recurringRules,
			db.expectedEvents,
			db.investmentHoldings,
			db.investmentValuations,
			db.liabilities,
			db.netWorthSnapshots,
			db.debtPlannerPreferences,
			db.savingsGoals,
			db.goalContributions,
			db.notificationPreferences,
			db.notifiedItems,
			db.attachments,
			db.categorizationRules,
			db.merchantCategorySignals,
			db.people,
			db.personLoans,
			db.personLoanRepayments,
			db.savedFilterViews,
			db.userProfile,
			db.sessionKeys,
			...localSettings
		],
		async () => {
			await Promise.all([
				...localSettings.map((table) => table.clear()),
				db.accounts.clear(),
				db.categories.clear(),
				db.merchants.clear(),
				db.merchantAliases.clear(),
				db.tags.clear(),
				db.transactions.clear(),
				db.transactionSplits.clear(),
				db.transactionTags.clear(),
				db.budgets.clear(),
				db.budgetItems.clear(),
				db.recurringRules.clear(),
				db.expectedEvents.clear(),
				db.investmentHoldings.clear(),
				db.investmentValuations.clear(),
				db.liabilities.clear(),
				db.netWorthSnapshots.clear(),
				db.debtPlannerPreferences.clear(),
				db.savingsGoals.clear(),
				db.goalContributions.clear(),
				db.notificationPreferences.clear(),
				db.notifiedItems.clear(),
				db.attachments.clear(),
				db.categorizationRules.clear(),
				db.merchantCategorySignals.clear(),
				db.people.clear(),
				db.personLoans.clear(),
				db.personLoanRepayments.clear(),
				db.savedFilterViews.clear(),
				db.userProfile.clear(),
				db.sessionKeys.clear()
			]);
		}
	);
}
