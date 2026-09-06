import { describe, it, expect } from 'vitest';
import {
	computeSavingsRate,
	computeExpenseToIncomeRatio,
	computeBudgetAdherence,
	buildMonthlyMetrics,
	computeFinancialHealthScore,
	MIN_HEALTH_SCORE_PERIODS,
	type FinancialHealthMetrics
} from '../../src/domain/analytics/financialHealthEngine';

describe('computeSavingsRate', () => {
	it('computes (income - expense) / income', () => {
		expect(computeSavingsRate(50000, 20000)).toBeCloseTo(0.6);
	});

	it('returns null when income is zero', () => {
		expect(computeSavingsRate(0, 5000)).toBeNull();
	});

	it('returns null when income is negative', () => {
		expect(computeSavingsRate(-1000, 5000)).toBeNull();
	});
});

describe('computeExpenseToIncomeRatio', () => {
	it('computes expense / income', () => {
		expect(computeExpenseToIncomeRatio(50000, 20000)).toBeCloseTo(0.4);
	});

	it('returns null when income is zero', () => {
		expect(computeExpenseToIncomeRatio(0, 5000)).toBeNull();
	});

	it('returns null when income is negative', () => {
		expect(computeExpenseToIncomeRatio(-1000, 5000)).toBeNull();
	});
});

describe('computeBudgetAdherence', () => {
	it('returns null adherence and considered=0 for an empty list', () => {
		expect(computeBudgetAdherence([])).toEqual({ adherence: null, considered: 0 });
	});

	it('computes the percentage within limit using <= (matching AnalyticsPage\'s over-budget check)', () => {
		const result = computeBudgetAdherence([
			{ plannedAmount: 1000, actualAmount: 900 }, // within limit
			{ plannedAmount: 1000, actualAmount: 1000 }, // exactly at limit -> within (uses <=)
			{ plannedAmount: 1000, actualAmount: 1100 } // over limit
		]);
		expect(result.considered).toBe(3);
		expect(result.adherence).toBeCloseTo((2 / 3) * 100);
	});

	it('returns 100% when every budget is within limit', () => {
		const result = computeBudgetAdherence([
			{ plannedAmount: 1000, actualAmount: 500 },
			{ plannedAmount: 2000, actualAmount: 2000 }
		]);
		expect(result.adherence).toBe(100);
	});

	it('returns 0% when every budget is over limit', () => {
		const result = computeBudgetAdherence([{ plannedAmount: 1000, actualAmount: 1500 }]);
		expect(result.adherence).toBe(0);
	});
});

describe('buildMonthlyMetrics', () => {
	it('composes savings rate, expense/income ratio, and budget adherence', () => {
		const metrics = buildMonthlyMetrics(50000, 20000, [
			{ plannedAmount: 1000, actualAmount: 900 },
			{ plannedAmount: 1000, actualAmount: 1100 }
		]);
		expect(metrics.income).toBe(50000);
		expect(metrics.expense).toBe(20000);
		expect(metrics.savingsRate).toBeCloseTo(0.6);
		expect(metrics.expenseToIncomeRatio).toBeCloseTo(0.4);
		expect(metrics.budgetAdherence).toBeCloseTo(50);
		expect(metrics.budgetsConsidered).toBe(2);
	});

	it('leaves ratios null and adherence null when there is no income and no budgets', () => {
		const metrics = buildMonthlyMetrics(0, 5000, []);
		expect(metrics.savingsRate).toBeNull();
		expect(metrics.expenseToIncomeRatio).toBeNull();
		expect(metrics.budgetAdherence).toBeNull();
		expect(metrics.budgetsConsidered).toBe(0);
	});
});

function metricsFixture(overrides: Partial<FinancialHealthMetrics>): FinancialHealthMetrics {
	return {
		month: '2026-01',
		income: 50000,
		expense: 20000,
		savingsRate: 0.6,
		expenseToIncomeRatio: 0.4,
		budgetAdherence: 80,
		budgetsConsidered: 2,
		...overrides
	};
}

describe('computeFinancialHealthScore', () => {
	it('returns the empty-score shape for an empty trend', () => {
		const result = computeFinancialHealthScore([]);
		expect(result.score).toBeNull();
		expect(result.dataQuality).toBe('limited');
		expect(result.breakdown.savingsRate).toEqual({ value: null, component: null, weight: 0.6 });
		expect(result.breakdown.budgetAdherence).toEqual({ value: null, component: null, weight: 0.4 });
	});

	it('weights both components 60/40 when both are available and quality is full with enough history', () => {
		const trend = [
			metricsFixture({ month: '2026-01' }),
			metricsFixture({ month: '2026-02' }),
			metricsFixture({ month: '2026-03' })
		];
		const result = computeFinancialHealthScore(trend);
		// savingsRate component = 60 (0.6*100), budgetAdherence component = 80
		// score = round(0.6*60 + 0.4*80) = round(36 + 32) = 68
		expect(result.score).toBe(68);
		expect(result.dataQuality).toBe('full');
	});

	it('uses the sole available component, unweighted, when budget adherence is unavailable', () => {
		const trend = [
			metricsFixture({ month: '2026-01', budgetAdherence: null, budgetsConsidered: 0 }),
			metricsFixture({ month: '2026-02', budgetAdherence: null, budgetsConsidered: 0 }),
			metricsFixture({ month: '2026-03', budgetAdherence: null, budgetsConsidered: 0 })
		];
		const result = computeFinancialHealthScore(trend);
		expect(result.score).toBe(60); // savingsRate component alone (0.6*100)
		expect(result.dataQuality).toBe('limited'); // budget adherence missing -> never 'full'
	});

	it('uses the sole available component when savings rate is unavailable (no income)', () => {
		const trend = [metricsFixture({ month: '2026-01', savingsRate: null, expenseToIncomeRatio: null, income: 0 })];
		const result = computeFinancialHealthScore(trend);
		expect(result.score).toBe(80); // budgetAdherence component alone
		expect(result.dataQuality).toBe('limited');
	});

	it('returns score null when neither component is available', () => {
		const trend = [
			metricsFixture({
				month: '2026-01',
				income: 0,
				savingsRate: null,
				expenseToIncomeRatio: null,
				budgetAdherence: null,
				budgetsConsidered: 0
			})
		];
		const result = computeFinancialHealthScore(trend);
		expect(result.score).toBeNull();
		expect(result.dataQuality).toBe('limited');
	});

	it('reports limited quality when fewer than MIN_HEALTH_SCORE_PERIODS months have income', () => {
		expect(MIN_HEALTH_SCORE_PERIODS).toBe(3);
		const trend = [metricsFixture({ month: '2026-01' }), metricsFixture({ month: '2026-02' })];
		const result = computeFinancialHealthScore(trend);
		expect(result.score).not.toBeNull();
		expect(result.dataQuality).toBe('limited');
	});

	it('reads only the last point for the score itself, regardless of earlier months', () => {
		const trend = [
			metricsFixture({ month: '2026-01', savingsRate: -1, budgetAdherence: 0 }),
			metricsFixture({ month: '2026-02', savingsRate: -1, budgetAdherence: 0 }),
			metricsFixture({ month: '2026-03', savingsRate: 0.6, budgetAdherence: 80 })
		];
		const result = computeFinancialHealthScore(trend);
		expect(result.score).toBe(68);
	});

	it('clamps a negative savings rate to 0 instead of pulling the score negative', () => {
		const trend = [
			metricsFixture({ month: '2026-01' }),
			metricsFixture({ month: '2026-02' }),
			metricsFixture({ month: '2026-03', savingsRate: -0.5, budgetAdherence: 0 })
		];
		const result = computeFinancialHealthScore(trend);
		expect(result.score).toBe(0);
	});
});
