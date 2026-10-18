import { CategoryRepository } from '../../data/dexie/categoryRepository';
import { todayLocalISO } from '../shared/dateMath';
import {
	buildCategoryColors,
	categoryColorOf,
	NEUTRAL_CATEGORY_COLOR
} from '../categories/categoryColor';
import {
	budgetPerformance,
	categoryBreakdown,
	incomeExpenseTrend,
	type MonthlyTrendPoint
} from './analyticsEngine';

export const TREND_MONTHS = 6;
/** Categories named on the dashboard before the rest are folded into "Other". */
export const TOP_CATEGORIES = 5;
const TOP_BUDGETS = 3;

export interface SpendingSlice {
	id: string;
	label: string;
	total: number;
	/** CSS colour: the category's own, or neutral for "Other". */
	color: string;
}

export interface BudgetStatus {
	id: string;
	label: string;
	planned: number;
	actual: number;
	color: string;
}

export interface DashboardInsights {
	/** `YYYY-MM` of the month being shown. */
	month: string;
	/** Money in, without what came back into a spending category (a refund, a repayment). */
	income: number;
	/** Money out after that money back: equals `spendingTotal`. */
	expense: number;
	/** The last `TREND_MONTHS` months, oldest first, with empty months present as zeros. */
	trend: MonthlyTrendPoint[];
	/** This month's spending, biggest first, at most `TOP_CATEGORIES` plus one "Other". */
	spending: SpendingSlice[];
	spendingTotal: number;
	/** The budgets closest to (or past) their limit this month. */
	budgets: BudgetStatus[];
}

/** The `count` months ending at the month of `todayIso`, oldest first, as `YYYY-MM`. */
export function lastMonths(todayIso: string, count: number): string[] {
	const [year, month] = todayIso.split('-').map(Number);
	return Array.from({ length: count }, (_, i) =>
		new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1)).toISOString().slice(0, 7)
	);
}

/** Last day of a `YYYY-MM` month. */
export function monthEnd(month: string): string {
	const [year, m] = month.split('-').map(Number);
	return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
}

/** `points` laid out on every month in `months`, with zeros where nothing happened. */
export function fillMonths(months: string[], points: MonthlyTrendPoint[]): MonthlyTrendPoint[] {
	const byMonth = new Map(points.map((p) => [p.month, p]));
	return months.map((month) => byMonth.get(month) ?? { month, income: 0, expense: 0, netFlow: 0 });
}

/** The biggest `limit` slices as they are, everything else added into one neutral "Other". */
export function foldTail<T extends { id: string; label: string; total: number; color: string }>(
	slices: T[],
	limit: number
): { id: string; label: string; total: number; color: string }[] {
	const head = slices.slice(0, limit);
	const tail = slices.slice(limit);
	if (tail.length === 0) return head;
	return [
		...head,
		{
			id: '__other__',
			label: 'Other',
			total: tail.reduce((sum, s) => sum + s.total, 0),
			color: NEUTRAL_CATEGORY_COLOR
		}
	];
}

/**
 * The figures behind the dashboard's charts, for the month of `today`. Every query is bounded by
 * date (six months at most), never the whole ledger.
 */
export async function getDashboardInsights(
	key: CryptoKey,
	today: string = todayLocalISO()
): Promise<DashboardInsights> {
	const months = lastMonths(today, TREND_MONTHS);
	const month = months[months.length - 1];
	const monthStart = `${month}-01`;
	const [trendPoints, spendingRaw, budgetItems, categories] = await Promise.all([
		// Netted the same way as the spending breakdown below, so "Money out" is what "Where it went"
		// adds up to instead of a larger gross figure beside it.
		incomeExpenseTrend(key, `${months[0]}-01`, monthEnd(month), { netRefunds: true, rollUp: true }),
		categoryBreakdown(key, monthStart, monthEnd(month), { rollUp: true }),
		budgetPerformance(key, monthStart, monthEnd(month)),
		CategoryRepository.list(key)
	]);
	const colors = buildCategoryColors(categories);
	const trend = fillMonths(months, trendPoints);
	const current = trend[trend.length - 1];

	const slices = spendingRaw.map((item) => ({
		id: item.categoryId,
		label: item.categoryName,
		total: item.total,
		color: categoryColorOf(colors, item.categoryId)
	}));

	const budgets = budgetItems
		.filter((b) => b.plannedAmount > 0)
		.map((b) => ({
			id: b.budgetId,
			label: b.categoryName,
			planned: b.plannedAmount,
			actual: b.actualAmount,
			color: categoryColorOf(colors, b.categoryId)
		}))
		.sort((a, b) => b.actual / b.planned - a.actual / a.planned)
		.slice(0, TOP_BUDGETS);

	return {
		month,
		income: current.income,
		expense: current.expense,
		trend,
		spending: foldTail(slices, TOP_CATEGORIES),
		spendingTotal: slices.reduce((sum, s) => sum + s.total, 0),
		budgets
	};
}
