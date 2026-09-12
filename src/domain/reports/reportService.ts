import { incomeExpenseTrend, categoryBreakdown } from '../analytics/analyticsEngine';
import { NetWorthSnapshotRepository } from '../../data/dexie/wealthRepository';
import { resolveReportPeriodRange, buildReportSummary, type ReportPeriod, type ReportSummary } from './reportEngine';

/**
 * Builds a full ReportSummary for a user-chosen period. Every figure comes from the existing
 * analyticsEngine.ts functions and the existing NetWorthSnapshotRepository — no independent
 * query against transactions, categories, or net worth (FR-010, research.md §1-3).
 */
export async function generateReportSummary(
	key: CryptoKey,
	period: ReportPeriod
): Promise<ReportSummary> {
	const range = resolveReportPeriodRange(period);

	const [trend, breakdown, snapshots] = await Promise.all([
		incomeExpenseTrend(key, range.periodStart, range.periodEnd),
		categoryBreakdown(key, range.periodStart, range.periodEnd),
		NetWorthSnapshotRepository.list(key)
	]);

	const income = trend.reduce((sum, point) => sum + point.income, 0);
	const expense = trend.reduce((sum, point) => sum + point.expense, 0);

	return buildReportSummary({
		period,
		range,
		today: new Date().toISOString().slice(0, 10),
		income,
		expense,
		categoryBreakdown: breakdown,
		snapshots
	});
}
