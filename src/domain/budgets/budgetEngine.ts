import { db } from '../../data/dexie/db';
import { decryptRows } from '../../data/dexie/encryptedTable';
import { BudgetItemRepository } from '../../data/dexie/budgetRepository';
import type { TransactionSplitRow } from '../../data/dexie/db';
import { NOT_DELETED } from '../../data/dexie/indexable';
import type { Budget, BudgetItem, TransactionSplit } from '../../domain/entities';

/** How many empty periods to walk back through when looking for a rollover source. Two years
 *  of monthly periods — far enough to cover a realistic gap, bounded so a brand-new budget
 *  doesn't scan indefinitely. */
const MAX_ROLLOVER_LOOKBACK = 24;

export interface PeriodRange {
	periodStart: string;
	periodEnd: string;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** The monthly/yearly period containing `referenceDate` (FR-023). */
export function getCurrentPeriodRange(
	periodType: Budget['periodType'],
	referenceDate: Date = new Date()
): PeriodRange {
	// Local calendar accessors, not UTC. Transaction dates come from `<input type="date">`,
	// which yields the user's *local* day, so deriving period bounds in UTC put the boundary in
	// the wrong place: in IST (UTC+5:30) the first 5.5 hours of every month were still measured
	// against the previous month's budget.
	const year = referenceDate.getFullYear();
	if (periodType === 'yearly') {
		return { periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` };
	}
	const month = referenceDate.getMonth();
	const lastDay = new Date(year, month + 1, 0).getDate();
	return {
		periodStart: `${year}-${pad(month + 1)}-01`,
		periodEnd: `${year}-${pad(month + 1)}-${pad(lastDay)}`
	};
}

/** The period immediately before the given one, for rollover lookups (FR-025). */
export function getPreviousPeriodRange(
	periodType: Budget['periodType'],
	currentStart: string
): PeriodRange {
	const [y, m] = currentStart.split('-').map(Number);
	if (periodType === 'yearly') {
		return { periodStart: `${y - 1}-01-01`, periodEnd: `${y - 1}-12-31` };
	}
	const prevMonthDate = new Date(y, m - 2, 1);
	return getCurrentPeriodRange('monthly', prevMonthDate);
}

/**
 * Sums how much was actually spent in `categoryId` within [periodStart, periodEnd]
 * (FR-024): the magnitude of net negative (expense) split amounts on non-deleted
 * transactions. Income booked to the same category nets against spend rather than
 * inflating it, but the result never reports "negative spending".
 */
export async function recalcActualAmount(
	key: CryptoKey,
	categoryId: string,
	periodStart: string,
	periodEnd: string
): Promise<number> {
	// Narrow on the `date` index first, then join. This previously loaded every split ever
	// recorded for the category and issued one `db.transactions.get(id)` per split — so the cost
	// grew with total history rather than with the period being calculated, on a path that runs
	// for every budget on every app unlock (runNotificationCheck).
	const txRows = await db.transactions
		.where('date')
		.between(periodStart, periodEnd, true, true)
		.filter((row) => row.deletedAt === NOT_DELETED)
		.toArray();
	if (txRows.length === 0) return 0;

	const idsInPeriod = new Set(txRows.map((r) => r.id));
	const splitRows = (
		await db.transactionSplits.where('categoryId').equals(categoryId).toArray()
	).filter((row) => idsInPeriod.has(row.transactionId));
	if (splitRows.length === 0) return 0;

	const splits = await decryptRows<TransactionSplitRow, TransactionSplit>(key, splitRows);
	const net = splits.reduce((sum, split) => sum + split.amount, 0);
	return Math.max(0, -net);
}

/**
 * Gets (or creates) the BudgetItem for the period containing `referenceDate`, applying
 * rollover from the previous period when enabled (FR-025) — sinking funds (FR-026) always
 * roll over their unused amount, since accumulating toward a goal is the point.
 */
export async function ensureCurrentBudgetItem(
	key: CryptoKey,
	budget: Budget,
	referenceDate: Date = new Date()
): Promise<BudgetItem> {
	const { periodStart, periodEnd } = getCurrentPeriodRange(budget.periodType, referenceDate);
	const existing = await BudgetItemRepository.findForPeriod(key, budget.id, periodStart);
	if (existing) {
		const actualAmount = await recalcActualAmount(key, budget.categoryId, periodStart, periodEnd);
		if (actualAmount !== existing.actualAmount) {
			return BudgetItemRepository.update(key, existing.id, { actualAmount });
		}
		return existing;
	}

	let rolloverInAmount = 0;
	if (budget.rolloverEnabled || budget.isSinkingFund) {
		// Walk back past periods the user never opened the app in. Items are created lazily, so
		// looking exactly one period back found nothing after any gap and silently reset the
		// accumulated balance to zero — which, for a sinking fund, destroys the entire point of
		// the feature (FR-026).
		let cursor = getPreviousPeriodRange(budget.periodType, periodStart);
		let prevItem = await BudgetItemRepository.findForPeriod(key, budget.id, cursor.periodStart);
		let skippedPeriods = 0;
		while (!prevItem && skippedPeriods < MAX_ROLLOVER_LOOKBACK) {
			skippedPeriods++;
			cursor = getPreviousPeriodRange(budget.periodType, cursor.periodStart);
			prevItem = await BudgetItemRepository.findForPeriod(key, budget.id, cursor.periodStart);
		}
		if (prevItem) {
			const unspent = Math.max(0, prevItem.plannedAmount - prevItem.actualAmount);
			// A sinking fund keeps accruing its allowance through the skipped periods; a plain
			// rollover budget only carries forward what was actually left unspent.
			rolloverInAmount = budget.isSinkingFund ? unspent + skippedPeriods * budget.amount : unspent;
		}
	}

	const plannedAmount = budget.amount + rolloverInAmount;
	const actualAmount = await recalcActualAmount(key, budget.categoryId, periodStart, periodEnd);

	return BudgetItemRepository.create(key, {
		budgetId: budget.id,
		periodStart,
		periodEnd,
		plannedAmount,
		actualAmount,
		rolloverInAmount
	});
}
