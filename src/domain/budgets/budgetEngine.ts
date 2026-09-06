import { db } from '../../data/dexie/db';
import { decryptRows } from '../../data/dexie/encryptedTable';
import { BudgetItemRepository } from '../../data/dexie/budgetRepository';
import type { TransactionSplitRow, TransactionRow } from '../../data/dexie/db';
import { NOT_DELETED } from '../../data/dexie/indexable';
import type { Budget, BudgetItem, TransactionSplit, Transaction } from '../../domain/entities';

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
	const year = referenceDate.getUTCFullYear();
	if (periodType === 'yearly') {
		return { periodStart: `${year}-01-01`, periodEnd: `${year}-12-31` };
	}
	const month = referenceDate.getUTCMonth();
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
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
	const prevMonthDate = new Date(Date.UTC(y, m - 2, 1));
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
	const splitRows = await db.transactionSplits.where('categoryId').equals(categoryId).toArray();
	const splits = await decryptRows<TransactionSplitRow, TransactionSplit>(key, splitRows);
	if (splits.length === 0) return 0;

	const transactionIds = [...new Set(splits.map((s) => s.transactionId))];
	const txRows = (await Promise.all(transactionIds.map((id) => db.transactions.get(id)))).filter(
		(r): r is TransactionRow => !!r && r.deletedAt === NOT_DELETED
	);
	const transactions = await decryptRows<TransactionRow, Transaction>(key, txRows);
	const txById = new Map(transactions.map((t) => [t.id, t]));

	let net = 0;
	for (const split of splits) {
		const tx = txById.get(split.transactionId);
		if (!tx || tx.date < periodStart || tx.date > periodEnd) continue;
		net += split.amount;
	}
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
		const prev = getPreviousPeriodRange(budget.periodType, periodStart);
		const prevItem = await BudgetItemRepository.findForPeriod(key, budget.id, prev.periodStart);
		if (prevItem) {
			rolloverInAmount = Math.max(0, prevItem.plannedAmount - prevItem.actualAmount);
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
