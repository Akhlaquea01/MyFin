import { getCurrentPeriodRange, type PeriodRange } from '../budgets/budgetEngine';
import type { CategoryBreakdownItem } from '../analytics/analyticsEngine';
import type { BudgetPeriodType, NetWorthSnapshot } from '../entities';

export interface ReportPeriod {
	type: BudgetPeriodType;
	year: number;
	/** 1-12. Required when type === 'monthly'; ignored when type === 'yearly'. */
	month?: number;
}

export interface ReportCategoryItem {
	categoryId: string;
	categoryName: string;
	total: number;
}

export interface ReportSummary {
	period: ReportPeriod;
	periodStart: string;
	periodEnd: string;
	periodLabel: string;
	isInProgress: boolean;
	income: number;
	expense: number;
	netIncome: number;
	topCategories: ReportCategoryItem[];
	netWorthStart: number | null;
	netWorthEnd: number | null;
	netWorthDelta: number | null;
}

export const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/** The calendar-month/year boundaries for a user-chosen (not necessarily current) period. */
export function resolveReportPeriodRange(period: ReportPeriod): PeriodRange {
	if (period.type === 'yearly') {
		return getCurrentPeriodRange('yearly', new Date(period.year, 0, 1));
	}
	return getCurrentPeriodRange('monthly', new Date(period.year, (period.month ?? 1) - 1, 1));
}

/** e.g. "March 2026" for a month, "2026" for a year (FR-006). */
export function formatReportPeriodLabel(period: ReportPeriod): string {
	if (period.type === 'yearly') return String(period.year);
	return `${MONTH_NAMES[(period.month ?? 1) - 1]} ${period.year}`;
}

/** True when `today` falls within the period's boundaries, inclusive (FR-009). */
export function isPeriodInProgress(range: PeriodRange, today: string): boolean {
	return range.periodStart <= today && today <= range.periodEnd;
}

/**
 * The top `limit` categories by spend, extended to include every category tied with the
 * limit-th item's total so a tie at the cutoff is never arbitrarily dropped (FR-003, Edge
 * Cases). Assumes `breakdown` is already sorted descending by `total`.
 */
export function topCategories(
	breakdown: CategoryBreakdownItem[],
	limit: number = 5
): ReportCategoryItem[] {
	if (breakdown.length === 0) return [];
	const result = breakdown.slice(0, limit);
	const cutoffTotal = result[result.length - 1].total;
	let i = result.length;
	while (i < breakdown.length && breakdown[i].total === cutoffTotal) {
		result.push(breakdown[i]);
		i++;
	}
	return result;
}

/**
 * The latest snapshot with `date <= date`, or `null` when none exists (FR-004, Edge Cases).
 * `snapshots` need not be pre-sorted. When multiple snapshots share the same date, the one
 * appearing last in `snapshots` wins.
 */
export function pickSnapshotAtOrBefore(
	snapshots: NetWorthSnapshot[],
	date: string
): NetWorthSnapshot | null {
	let best: NetWorthSnapshot | null = null;
	for (const snapshot of snapshots) {
		if (snapshot.date > date) continue;
		if (!best || snapshot.date >= best.date) best = snapshot;
	}
	return best;
}

/** Pure composition of the functions above into one ReportSummary (data-model.md). */
export function buildReportSummary(input: {
	period: ReportPeriod;
	range: PeriodRange;
	today: string;
	income: number;
	expense: number;
	categoryBreakdown: CategoryBreakdownItem[];
	snapshots: NetWorthSnapshot[];
}): ReportSummary {
	const netWorthStart = pickSnapshotAtOrBefore(input.snapshots, input.range.periodStart)?.netWorth ?? null;
	const netWorthEnd = pickSnapshotAtOrBefore(input.snapshots, input.range.periodEnd)?.netWorth ?? null;

	return {
		period: input.period,
		periodStart: input.range.periodStart,
		periodEnd: input.range.periodEnd,
		periodLabel: formatReportPeriodLabel(input.period),
		isInProgress: isPeriodInProgress(input.range, input.today),
		income: input.income,
		expense: input.expense,
		netIncome: input.income - input.expense,
		topCategories: topCategories(input.categoryBreakdown),
		netWorthStart,
		netWorthEnd,
		netWorthDelta: netWorthStart !== null && netWorthEnd !== null ? netWorthEnd - netWorthStart : null
	};
}
