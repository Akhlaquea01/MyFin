import { CategoryRepository } from '../../data/dexie/categoryRepository';
import { buildCategoryLabels, topLevelAncestorId } from '../categories/categoryHierarchy';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../data/dexie/transactionRepository';
import { BudgetRepository, BudgetItemRepository } from '../../data/dexie/budgetRepository';
import { NetWorthSnapshotRepository } from '../../data/dexie/wealthRepository';
import type { Category, PurposeKind, TransactionSplit } from '../entities';

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

export interface CategoryBreakdownOptions {
	/**
	 * Attribute each subcategory's spending to its top-level parent, so "Food" shows everything spent
	 * on groceries, dining out and the rest as one figure (default false: each category on its own).
	 */
	rollUp?: boolean;
}

/**
 * Adds `splits` to the running net movement per category (negative is spending). Unlabelled money in
 * — an uncategorized positive — is skipped: a salary is as likely as a refund, so it must never
 * offset spending. The one place this rule lives, so the category chart and the month's money out
 * cannot drift apart.
 */
function addToNet(
	net: Map<string, number>,
	splits: TransactionSplit[],
	categories: Category[],
	rollUp: boolean | undefined
): void {
	for (const split of splits) {
		if (split.categoryId === UNCATEGORIZED_CATEGORY_ID && split.amount >= 0) continue;
		const target = rollUp ? topLevelAncestorId(categories, split.categoryId) : split.categoryId;
		net.set(target, (net.get(target) ?? 0) + split.amount);
	}
}

/**
 * Spending by category over [dateFrom, dateTo] (FR-035): what was spent in each category, joined
 * against each split's transaction date. Money coming back into a category (a refund, a
 * reimbursement) is netted against what was spent there, never below zero — the same rule the
 * Budgets use, so a ₹2,000 refund on ₹5,000 of Shopping reads ₹3,000 in both places. "Uncategorized"
 * is the exception: its money in is unlabelled (a salary as likely as a refund), so only what went
 * out counts there. A category that only received money is not spending and is left out.
 *
 * A subcategory is labelled with its full path ("Food › Groceries"), so two parents that each have
 * an "Other" child no longer produce two indistinguishable "Other" bars. With `rollUp`, spending
 * is grouped under the top-level ancestor instead and labelled with just its name.
 */
export async function categoryBreakdown(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string,
	options: CategoryBreakdownOptions = {}
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
	const labels = buildCategoryLabels(categories);

	// Net movement per category: negative is spending.
	const net = new Map<string, number>();
	for (const tx of transactions) {
		// A transfer (card bill payment, savings move) and a loan movement are not spending. They were
		// counted here as "Uncategorized" spend — so every card payment inflated the Uncategorized slice
		// of the category chart and the spending total of the Year-in-Review report — while the
		// income/expense trend right below already excluded them, leaving the two figures disagreeing.
		if (tx.type === 'transfer') continue;
		addToNet(net, splitsByTx.get(tx.id) ?? [], categories, options.rollUp);
	}

	return [...net.entries()]
		.filter(([, movement]) => movement < 0)
		.map(([categoryId, movement]) => ({
			categoryId,
			categoryName: labels.get(categoryId) ?? 'Uncategorized',
			total: -movement
		}))
		.sort((a, b) => b.total - a.total);
}

export interface CategoryActivityItem {
	categoryId: string;
	/** Money out, as a positive figure. */
	expense: number;
	/** Money in. */
	income: number;
	/** Entries with money out under this category / with money in. A split entry counts once. */
	expenseCount: number;
	incomeCount: number;
}

/**
 * What was filed under each category over [dateFrom, dateTo], split into money out and money in,
 * with how many entries made it up. Directly under each category only: callers that want a parent's
 * total add its subcategories. Transfers are not income or spending and are left out, as in
 * `categoryBreakdown`, which keeps its own, narrower shape on purpose (other reports assert it).
 */
export async function categoryActivity(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string
): Promise<CategoryActivityItem[]> {
	const transactions = await TransactionRepository.search(key, { dateFrom, dateTo });
	const splitsByTx = await TransactionRepository.splitsByTransaction(
		key,
		transactions.map((t) => t.id)
	);
	const byCategory = new Map<
		string,
		{ item: CategoryActivityItem; out: Set<string>; in: Set<string> }
	>();
	for (const tx of transactions) {
		if (tx.type === 'transfer') continue;
		for (const split of splitsByTx.get(tx.id) ?? []) {
			let entry = byCategory.get(split.categoryId);
			if (!entry) {
				entry = {
					item: {
						categoryId: split.categoryId,
						expense: 0,
						income: 0,
						expenseCount: 0,
						incomeCount: 0
					},
					out: new Set(),
					in: new Set()
				};
				byCategory.set(split.categoryId, entry);
			}
			if (split.amount < 0) {
				entry.item.expense += -split.amount;
				entry.out.add(tx.id);
			} else if (split.amount > 0) {
				entry.item.income += split.amount;
				entry.in.add(tx.id);
			}
		}
	}
	return [...byCategory.values()].map(({ item, out, in: inbound }) => ({
		...item,
		expenseCount: out.size,
		incomeCount: inbound.size
	}));
}

export interface PurposeBreakdownItem {
	kind: PurposeKind;
	/** Spend magnitude (positive). */
	total: number;
	/** How many entries make it up. */
	count: number;
}

/**
 * How much of the spending in [dateFrom, dateTo] was marked as debt repayment, savings, investment or
 * bills. Kept apart from `categoryBreakdown` on purpose: a purpose cuts across categories (an EMI is
 * "Loans" by category and "debt" by purpose), and adding it there would change figures that the
 * dashboard, the year-in-review and the health score are built on. Only entries that carry a purpose
 * appear; largest first.
 */
export async function purposeBreakdown(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string
): Promise<PurposeBreakdownItem[]> {
	const transactions = await TransactionRepository.search(key, { dateFrom, dateTo });
	const totals = new Map<PurposeKind, PurposeBreakdownItem>();
	for (const tx of transactions) {
		if (!tx.purpose || tx.type !== 'expense' || tx.amount >= 0) continue;
		const item = totals.get(tx.purpose.kind) ?? { kind: tx.purpose.kind, total: 0, count: 0 };
		item.total += -tx.amount;
		item.count += 1;
		totals.set(tx.purpose.kind, item);
	}
	return [...totals.values()].sort((a, b) => b.total - a.total);
}

export interface IncomeExpenseOptions extends CategoryBreakdownOptions {
	/**
	 * Take money that came back into a spending category (a refund, a reimbursement, a friend paying
	 * you back) off money out instead of counting it as money in — the rule `categoryBreakdown` and
	 * the Budgets use, so a month's money out equals what its category breakdown adds up to. Net flow
	 * is the same either way. Off by default: the reports and the health score read the gross figures.
	 */
	netRefunds?: boolean;
}

async function monthlyIncomeExpense(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string,
	options: IncomeExpenseOptions = {}
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
	if (!options.netRefunds) return byMonth;

	const [categories, splitsByTx] = await Promise.all([
		CategoryRepository.list(key),
		TransactionRepository.splitsByTransaction(
			key,
			transactions.map((t) => t.id)
		)
	]);
	const netByMonth = new Map<string, Map<string, number>>();
	for (const tx of transactions) {
		if (tx.type === 'transfer') continue;
		const month = tx.date.slice(0, 7);
		const net = netByMonth.get(month) ?? new Map<string, number>();
		addToNet(net, splitsByTx.get(tx.id) ?? [], categories, options.rollUp);
		netByMonth.set(month, net);
	}
	for (const [month, net] of netByMonth) {
		const bucket = byMonth.get(month);
		if (!bucket) continue;
		let spent = 0;
		for (const movement of net.values()) if (movement < 0) spent -= movement;
		// What came back moves from money in to off money out, so income - expense is unchanged.
		bucket.income -= bucket.expense - spent;
		bucket.expense = spent;
	}
	return byMonth;
}

/** Monthly income/expense/net-flow trend over [dateFrom, dateTo] (FR-035). */
export async function incomeExpenseTrend(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string,
	options: IncomeExpenseOptions = {}
): Promise<MonthlyTrendPoint[]> {
	const byMonth = await monthlyIncomeExpense(key, dateFrom, dateTo, options);
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
	const categoryNameById = buildCategoryLabels(categories);

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
