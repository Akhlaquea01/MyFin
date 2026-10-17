import type { BackupPayload } from '../backupService';

/** Older backups carry the `deletedAt` soft-delete marker; a timestamp there means "in Trash". */
type MaybeTrashed = { deletedAt?: number | null };

const isTrashed = (row: object) => !!(row as MaybeTrashed).deletedAt;

/**
 * Drops everything a pre-1.5.0 backup held in Trash, plus what hung off it. Deletes are permanent
 * now and there is no Trash screen to show or purge such rows, so restoring them would leave data
 * nobody can see or remove.
 */
export function dropTrashed(payload: BackupPayload): BackupPayload {
	const e = payload.exportedEntities;
	const trashedIds = (rows: { id: string }[]) =>
		new Set(rows.filter(isTrashed).map((row) => row.id));
	const keepLive = <T extends { id: string }>(rows: T[]) => rows.filter((row) => !isTrashed(row));

	const transactionIds = trashedIds(e.transactions);
	const holdingIds = trashedIds(e.investmentHoldings);
	const goalIds = trashedIds(e.savingsGoals);
	const budgetIds = trashedIds(e.budgets);
	const personIds = trashedIds(e.people);
	const loanIds = trashedIds(e.personLoans);
	for (const loan of e.personLoans) if (personIds.has(loan.personId)) loanIds.add(loan.id);

	return {
		...payload,
		exportedEntities: {
			...e,
			accounts: keepLive(e.accounts),
			categories: keepLive(e.categories),
			merchants: keepLive(e.merchants),
			transactions: keepLive(e.transactions),
			transactionSplits: e.transactionSplits.filter((s) => !transactionIds.has(s.transactionId)),
			transactionTags: e.transactionTags.filter((t) => !transactionIds.has(t.transactionId)),
			attachments: e.attachments.filter((a) => !transactionIds.has(a.transactionId)),
			budgets: keepLive(e.budgets),
			budgetItems: e.budgetItems.filter((i) => !budgetIds.has(i.budgetId)),
			investmentHoldings: keepLive(e.investmentHoldings),
			investmentValuations: e.investmentValuations.filter((v) => !holdingIds.has(v.holdingId)),
			liabilities: keepLive(e.liabilities),
			savingsGoals: keepLive(e.savingsGoals),
			goalContributions: e.goalContributions.filter((c) => !goalIds.has(c.goalId)),
			categorizationRules: keepLive(e.categorizationRules),
			people: keepLive(e.people),
			personLoans: e.personLoans.filter((l) => !loanIds.has(l.id)),
			personLoanRepayments: keepLive(e.personLoanRepayments).filter((r) => !loanIds.has(r.loanId))
		}
	};
}
