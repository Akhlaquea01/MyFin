import { describe, it, expect } from 'vitest';
import {
	budgetPeriodLabel,
	budgetPerformanceInMonth,
	budgetYears,
	groupBudgetPerformance
} from '../../src/domain/analytics/budgetPeriodLabel';
import type { BudgetPerformanceItem } from '../../src/domain/analytics/analyticsEngine';

const item = (budgetId: string, periodStart: string, periodEnd: string): BudgetPerformanceItem => ({
	budgetId,
	categoryId: budgetId,
	categoryName: budgetId,
	periodStart,
	periodEnd,
	plannedAmount: 100,
	actualAmount: 0
});

describe('budgetPeriodLabel', () => {
	it('names a calendar month by month and year, not by its first day', () => {
		const label = budgetPeriodLabel('2026-05-01', '2026-05-31');
		expect(label).toMatch(/May/);
		expect(label).toMatch(/2026/);
		expect(label).not.toMatch(/2026-05-01/);
	});

	it('knows the last day of a short month', () => {
		expect(budgetPeriodLabel('2028-02-01', '2028-02-29')).toMatch(/Feb/);
	});

	it('names a calendar year by its year', () => {
		expect(budgetPeriodLabel('2026-01-01', '2026-12-31')).toBe('2026');
	});

	it('writes any other period as a range', () => {
		const label = budgetPeriodLabel('2026-05-10', '2026-06-09');
		expect(label).toContain('–');
		expect(label).toMatch(/2026/);
	});
});

describe('groupBudgetPerformance', () => {
	it('puts every budget of a period under one heading, keeping the period order', () => {
		const groups = groupBudgetPerformance([
			item('a', '2026-05-01', '2026-05-31'),
			item('b', '2026-05-01', '2026-05-31'),
			item('a', '2026-06-01', '2026-06-30')
		]);
		expect(groups.map((g) => g.items.map((i) => i.budgetId))).toEqual([['a', 'b'], ['a']]);
		expect(groups[0].label).not.toBe(groups[1].label);
	});

	it('keeps a monthly and a yearly period that start the same day apart', () => {
		const groups = groupBudgetPerformance([
			item('a', '2026-01-01', '2026-01-31'),
			item('b', '2026-01-01', '2026-12-31')
		]);
		expect(groups).toHaveLength(2);
	});

	it('is empty for no budgets', () => {
		expect(groupBudgetPerformance([])).toEqual([]);
	});
});

describe('budgetPerformanceInMonth', () => {
	const rows = [
		item('may', '2026-05-01', '2026-05-31'),
		item('june', '2026-06-01', '2026-06-30'),
		item('year', '2026-01-01', '2026-12-31'),
		item('leap-feb', '2028-02-01', '2028-02-29')
	];
	const ids = (year: number, month: number) =>
		budgetPerformanceInMonth(rows, year, month).map((r) => r.budgetId);

	it('keeps only the periods that fall in the chosen month', () => {
		expect(ids(2026, 5)).toEqual(['may', 'year']);
		expect(ids(2026, 6)).toEqual(['june', 'year']);
	});

	it('shows a yearly budget in each month of its year and in no other', () => {
		expect(ids(2026, 12)).toEqual(['year']);
		expect(ids(2027, 1)).toEqual([]);
	});

	it('includes the last day of a leap February', () => {
		expect(ids(2028, 2)).toEqual(['leap-feb']);
		expect(ids(2028, 3)).toEqual([]);
	});

	it('is empty when nothing is budgeted that month', () => {
		expect(budgetPerformanceInMonth([], 2026, 5)).toEqual([]);
	});
});

describe('budgetYears', () => {
	it('offers every year a period touches, newest first', () => {
		const years = budgetYears(
			[item('a', '2024-03-01', '2024-03-31'), item('b', '2025-12-01', '2026-01-31')],
			2026
		);
		expect(years).toEqual([2026, 2025, 2024]);
	});

	it('always offers the current year, even with no budgets', () => {
		expect(budgetYears([], 2026)).toEqual([2026]);
	});

	it('lists a year once however many periods fall in it', () => {
		const years = budgetYears(
			[item('a', '2026-01-01', '2026-01-31'), item('b', '2026-02-01', '2026-02-28')],
			2026
		);
		expect(years).toEqual([2026]);
	});
});
