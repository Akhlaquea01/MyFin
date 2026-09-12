import { describe, it, expect } from 'vitest';
import {
	resolveReportPeriodRange,
	formatReportPeriodLabel,
	isPeriodInProgress,
	topCategories,
	pickSnapshotAtOrBefore,
	buildReportSummary
} from '../../src/domain/reports/reportEngine';
import type { ReportCategoryItem } from '../../src/domain/reports/reportEngine';
import type { NetWorthSnapshot } from '../../src/domain/entities';

describe('resolveReportPeriodRange', () => {
	it('bounds a chosen month to its calendar boundaries', () => {
		expect(resolveReportPeriodRange({ type: 'monthly', year: 2026, month: 3 })).toEqual({
			periodStart: '2026-03-01',
			periodEnd: '2026-03-31'
		});
	});

	it('handles a leap-year February', () => {
		expect(resolveReportPeriodRange({ type: 'monthly', year: 2028, month: 2 })).toEqual({
			periodStart: '2028-02-01',
			periodEnd: '2028-02-29'
		});
	});

	it('handles a non-leap-year February', () => {
		expect(resolveReportPeriodRange({ type: 'monthly', year: 2026, month: 2 })).toEqual({
			periodStart: '2026-02-01',
			periodEnd: '2026-02-28'
		});
	});

	it('handles December without rolling into the next year', () => {
		expect(resolveReportPeriodRange({ type: 'monthly', year: 2026, month: 12 })).toEqual({
			periodStart: '2026-12-01',
			periodEnd: '2026-12-31'
		});
	});

	it('bounds a chosen year to Jan 1 - Dec 31', () => {
		expect(resolveReportPeriodRange({ type: 'yearly', year: 2025 })).toEqual({
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31'
		});
	});
});

describe('formatReportPeriodLabel', () => {
	it('labels a month with its month name and year', () => {
		expect(formatReportPeriodLabel({ type: 'monthly', year: 2026, month: 3 })).toBe('March 2026');
	});

	it('labels a year with just the year', () => {
		expect(formatReportPeriodLabel({ type: 'yearly', year: 2026 })).toBe('2026');
	});
});

describe('isPeriodInProgress', () => {
	it('is true when today falls inside the period', () => {
		const range = { periodStart: '2026-09-01', periodEnd: '2026-09-30' };
		expect(isPeriodInProgress(range, '2026-09-12')).toBe(true);
		expect(isPeriodInProgress(range, '2026-09-01')).toBe(true);
		expect(isPeriodInProgress(range, '2026-09-30')).toBe(true);
	});

	it('is false for a fully past period', () => {
		const range = { periodStart: '2026-01-01', periodEnd: '2026-01-31' };
		expect(isPeriodInProgress(range, '2026-09-12')).toBe(false);
	});

	it('is false for a fully future period', () => {
		const range = { periodStart: '2027-01-01', periodEnd: '2027-01-31' };
		expect(isPeriodInProgress(range, '2026-09-12')).toBe(false);
	});
});

describe('topCategories', () => {
	function item(categoryId: string, total: number): ReportCategoryItem {
		return { categoryId, categoryName: categoryId, total };
	}

	it('returns the top 5 by default', () => {
		const breakdown = [
			item('a', 600),
			item('b', 500),
			item('c', 400),
			item('d', 300),
			item('e', 200),
			item('f', 100)
		];
		expect(topCategories(breakdown).map((c) => c.categoryId)).toEqual(['a', 'b', 'c', 'd', 'e']);
	});

	it('includes every category tied with the cutoff item', () => {
		const breakdown = [item('a', 600), item('b', 500), item('c', 400), item('d', 300), item('e', 200), item('f', 200)];
		expect(topCategories(breakdown, 5).map((c) => c.categoryId)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
	});

	it('returns an empty array for empty input', () => {
		expect(topCategories([])).toEqual([]);
	});

	it('respects a custom limit', () => {
		const breakdown = [item('a', 300), item('b', 200), item('c', 100)];
		expect(topCategories(breakdown, 2).map((c) => c.categoryId)).toEqual(['a', 'b']);
	});
});

describe('pickSnapshotAtOrBefore', () => {
	function snapshot(date: string, netWorth: number): NetWorthSnapshot {
		return {
			id: date,
			date,
			totalAssets: netWorth,
			totalLiabilities: 0,
			netWorth,
			createdAt: 0,
			updatedAt: 0
		};
	}

	it('returns the latest snapshot at or before the date', () => {
		const snapshots = [snapshot('2026-01-01', 1000), snapshot('2026-06-01', 2000), snapshot('2026-12-01', 3000)];
		expect(pickSnapshotAtOrBefore(snapshots, '2026-09-01')?.netWorth).toBe(2000);
	});

	it('returns the exact match when the date itself has a snapshot', () => {
		const snapshots = [snapshot('2026-01-01', 1000), snapshot('2026-09-01', 2500)];
		expect(pickSnapshotAtOrBefore(snapshots, '2026-09-01')?.netWorth).toBe(2500);
	});

	it('returns null when no snapshot exists at or before the date', () => {
		const snapshots = [snapshot('2026-06-01', 2000)];
		expect(pickSnapshotAtOrBefore(snapshots, '2026-01-01')).toBeNull();
	});

	it('returns null for an empty snapshot list', () => {
		expect(pickSnapshotAtOrBefore([], '2026-01-01')).toBeNull();
	});

	it('does not require snapshots to be pre-sorted', () => {
		const snapshots = [snapshot('2026-12-01', 3000), snapshot('2026-01-01', 1000), snapshot('2026-06-01', 2000)];
		expect(pickSnapshotAtOrBefore(snapshots, '2026-09-01')?.netWorth).toBe(2000);
	});
});

describe('buildReportSummary', () => {
	function snapshot(date: string, netWorth: number): NetWorthSnapshot {
		return {
			id: date,
			date,
			totalAssets: netWorth,
			totalLiabilities: 0,
			netWorth,
			createdAt: 0,
			updatedAt: 0
		};
	}

	const period = { type: 'monthly' as const, year: 2026, month: 9 };
	const range = { periodStart: '2026-09-01', periodEnd: '2026-09-30' };

	it('composes a populated summary from its inputs', () => {
		const summary = buildReportSummary({
			period,
			range,
			today: '2026-01-01',
			income: 50000,
			expense: 20000,
			categoryBreakdown: [
				{ categoryId: 'groceries', categoryName: 'Groceries', total: 12000 },
				{ categoryId: 'dining', categoryName: 'Dining', total: 8000 }
			],
			snapshots: [snapshot('2026-08-15', 100000), snapshot('2026-09-20', 130000)]
		});

		expect(summary.periodStart).toBe('2026-09-01');
		expect(summary.periodEnd).toBe('2026-09-30');
		expect(summary.periodLabel).toBe('September 2026');
		expect(summary.isInProgress).toBe(false);
		expect(summary.income).toBe(50000);
		expect(summary.expense).toBe(20000);
		expect(summary.netIncome).toBe(30000);
		expect(summary.topCategories.map((c) => c.categoryId)).toEqual(['groceries', 'dining']);
		expect(summary.netWorthStart).toBe(100000);
		expect(summary.netWorthEnd).toBe(130000);
		expect(summary.netWorthDelta).toBe(30000);
	});

	it('produces zeros and nulls for a period with no data, never an error', () => {
		const summary = buildReportSummary({
			period,
			range,
			today: '2026-01-01',
			income: 0,
			expense: 0,
			categoryBreakdown: [],
			snapshots: []
		});

		expect(summary.income).toBe(0);
		expect(summary.expense).toBe(0);
		expect(summary.netIncome).toBe(0);
		expect(summary.topCategories).toEqual([]);
		expect(summary.netWorthStart).toBeNull();
		expect(summary.netWorthEnd).toBeNull();
		expect(summary.netWorthDelta).toBeNull();
	});

	it('leaves netWorthDelta null when only one boundary has a snapshot', () => {
		const summary = buildReportSummary({
			period,
			range,
			today: '2026-01-01',
			income: 0,
			expense: 0,
			categoryBreakdown: [],
			snapshots: [snapshot('2026-09-20', 130000)]
		});

		expect(summary.netWorthStart).toBeNull();
		expect(summary.netWorthEnd).toBe(130000);
		expect(summary.netWorthDelta).toBeNull();
	});

	it('flags an in-progress period using the supplied today', () => {
		const summary = buildReportSummary({
			period,
			range,
			today: '2026-09-15',
			income: 0,
			expense: 0,
			categoryBreakdown: [],
			snapshots: []
		});

		expect(summary.isInProgress).toBe(true);
	});
});
