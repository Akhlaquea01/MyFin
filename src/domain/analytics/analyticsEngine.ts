import { CategoryRepository } from '../../data/dexie/categoryRepository';
import { TransactionRepository } from '../../data/dexie/transactionRepository';
import { BudgetRepository, BudgetItemRepository } from '../../data/dexie/budgetRepository';
import { NetWorthSnapshotRepository } from '../../data/dexie/wealthRepository';

export interface CategoryBreakdownItem {
	categoryId: string;
	categoryName: string;
	total: number; // spend magnitude (positive)
}

export interface MonthlyTrendPoint {
	month: string; // YYYY-MM
	income: number;
	expense: number; // positive magnitude
	netFlow: number; // income - expense
}

export interface CashFlowPoint {
	month: string; // YYYY-MM
	netFlow: number; // income - expense for the month
	cumulativeFlow: number; // running total across the selected range
}

export interface BudgetPerformanceItem {
	budgetId: string;
	categoryId: string;
	categoryName: string;
	periodStart: string;
	periodEnd: string;
	plannedAmount: number;
	actualAmount: number;
}

export interface NetWorthTrendPoint {
	date: string;
	netWorth: number;
}

/**
 * Spending by category over [dateFrom, dateTo] (FR-035): sums the magnitude of negative
 * (expense) split amounts, joined against each split's transaction date.
 */
export async function categoryBreakdown(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string
): Promise<CategoryBreakdownItem[]> {
	const [categories, transactions] = await Promise.all([
		CategoryRepository.list(key),
		TransactionRepository.search(key, { dateFrom, dateTo })
	]);
	// Fetch only the splits belonging to the date-ranged transactions. This previously called
	// `db.transactionSplits.toArray()` and decrypted every split in the database regardless of
	// the selected range, then discarded most of them.
	const splitsByTx = await TransactionRepository.splitsByTransaction(
		key,
		transactions.map((t) => t.id)
	);
	const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

	const totals = new Map<string, number>();
	for (const tx of transactions) {
		for (const split of splitsByTx.get(tx.id) ?? []) {
			if (split.amount >= 0) continue; // only expense splits count as "spending"
			totals.set(split.categoryId, (totals.get(split.categoryId) ?? 0) - split.amount);
		}
	}

	return [...totals.entries()]
		.map(([categoryId, total]) => ({
			categoryId,
			categoryName: categoryNameById.get(categoryId) ?? 'Uncategorized',
			total
		}))
		.sort((a, b) => b.total - a.total);
}

async function monthlyIncomeExpense(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string
): Promise<Map<string, { income: number; expense: number }>> {
	const transactions = await TransactionRepository.search(key, { dateFrom, dateTo });
	const byMonth = new Map<string, { income: number; expense: number }>();

	for (const tx of transactions) {
		if (tx.type === 'transfer') continue;
		const month = tx.date.slice(0, 7);
		const bucket = byMonth.get(month) ?? { income: 0, expense: 0 };
		if (tx.amount >= 0) bucket.income += tx.amount;
		else bucket.expense += -tx.amount;
		byMonth.set(month, bucket);
	}
	return byMonth;
}

/** Monthly income/expense/net-flow trend over [dateFrom, dateTo] (FR-035). */
export async function incomeExpenseTrend(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string
): Promise<MonthlyTrendPoint[]> {
	const byMonth = await monthlyIncomeExpense(key, dateFrom, dateTo);
	return [...byMonth.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([month, { income, expense }]) => ({ month, income, expense, netFlow: income - expense }));
}

/** Monthly net cash flow, with a running cumulative total over [dateFrom, dateTo] (FR-035). */
export async function cashFlowTrend(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string
): Promise<CashFlowPoint[]> {
	const byMonth = await monthlyIncomeExpense(key, dateFrom, dateTo);
	let cumulative = 0;
	return [...byMonth.entries()]
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([month, { income, expense }]) => {
			const netFlow = income - expense;
			cumulative += netFlow;
			return { month, netFlow, cumulativeFlow: cumulative };
		});
}

/** Planned vs. actual for every budget's periods overlapping [dateFrom, dateTo] (FR-035). */
export async function budgetPerformance(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string
): Promise<BudgetPerformanceItem[]> {
	const [budgets, categories] = await Promise.all([
		BudgetRepository.list(key),
		CategoryRepository.list(key)
	]);
	const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

	// One round of lookups in parallel rather than a sequential await per budget.
	const itemsPerBudget = await Promise.all(
		budgets.map((budget) => BudgetItemRepository.listForBudget(key, budget.id))
	);

	const results: BudgetPerformanceItem[] = [];
	for (const [index, budget] of budgets.entries()) {
		for (const item of itemsPerBudget[index]) {
			if (item.periodEnd < dateFrom || item.periodStart > dateTo) continue;
			results.push({
				budgetId: budget.id,
				categoryId: budget.categoryId,
				categoryName: categoryNameById.get(budget.categoryId) ?? 'Uncategorized',
				periodStart: item.periodStart,
				periodEnd: item.periodEnd,
				plannedAmount: item.plannedAmount,
				actualAmount: item.actualAmount
			});
		}
	}
	return results.sort((a, b) => (a.periodStart < b.periodStart ? -1 : 1));
}

/** Net worth history restricted to [dateFrom, dateTo] (FR-035). */
export async function netWorthTrend(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string
): Promise<NetWorthTrendPoint[]> {
	const history = await NetWorthSnapshotRepository.list(key);
	return history
		.filter((s) => s.date >= dateFrom && s.date <= dateTo)
		.map((s) => ({ date: s.date, netWorth: s.netWorth }));
}
