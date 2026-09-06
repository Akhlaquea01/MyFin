/**
 * Thin, read-only orchestrator for the Financial Health Insights panel (spec 007). Calls only
 * the *existing* `incomeExpenseTrend`/`budgetPerformance` functions from `analyticsEngine.ts`
 * — never a new Dexie query — so this panel structurally cannot drift from what Analytics/
 * Budgets already show (FR-007, research.md §1-2). Never writes anything.
 */
import { incomeExpenseTrend, budgetPerformance } from './analyticsEngine';
import {
	buildMonthlyMetrics,
	computeFinancialHealthScore,
	type FinancialHealthMetrics,
	type FinancialHealthScore
} from './financialHealthEngine';

/**
 * One `FinancialHealthMetrics` row per month in `[dateFrom, dateTo]` that has income/expense
 * activity, ascending by month. A `BudgetPerformanceItem` is bucketed into the month its
 * period *starts* in (`periodStart.slice(0, 7)`) — a yearly budget's single period therefore
 * counts only in its start month, not prorated across the months it spans (research.md §3).
 */
export async function getFinancialHealthTrend(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string
): Promise<FinancialHealthMetrics[]> {
	const [trend, budgetItems] = await Promise.all([
		incomeExpenseTrend(key, dateFrom, dateTo),
		budgetPerformance(key, dateFrom, dateTo)
	]);

	const budgetsByMonth = new Map<string, { plannedAmount: number; actualAmount: number }[]>();
	for (const item of budgetItems) {
		const month = item.periodStart.slice(0, 7);
		const bucket = budgetsByMonth.get(month) ?? [];
		bucket.push({ plannedAmount: item.plannedAmount, actualAmount: item.actualAmount });
		budgetsByMonth.set(month, bucket);
	}

	return trend.map((point) => ({
		month: point.month,
		...buildMonthlyMetrics(point.income, point.expense, budgetsByMonth.get(point.month) ?? [])
	}));
}

/**
 * Composite score derived from the same trend the UI renders — no independent calculation
 * that could silently disagree with it (research.md §5).
 */
export async function getFinancialHealthScore(
	key: CryptoKey,
	dateFrom: string,
	dateTo: string
): Promise<FinancialHealthScore> {
	const trend = await getFinancialHealthTrend(key, dateFrom, dateTo);
	return computeFinancialHealthScore(trend);
}
