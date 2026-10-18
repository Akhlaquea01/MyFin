import { describe, it, expect } from 'vitest';
import {
	budgetPeriodLabel,
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
