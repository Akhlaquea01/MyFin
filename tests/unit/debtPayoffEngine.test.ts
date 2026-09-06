import { describe, it, expect } from 'vitest';
import {
	partitionEligibleLiabilities,
	generateDebtPayoffPlan,
	compareStrategies
} from '../../src/domain/debtPlanner/generatePlan';
import type { Liability } from '../../src/domain/entities';

function liability(overrides: Partial<Liability> & { id: string }): Liability {
	return {
		name: overrides.id,
		type: 'loan',
		outstandingBalance: 0,
		emiAmount: null,
		emiDueDay: null,
		interestRate: null,
		minimumPayment: null,
		createdAt: 0,
		updatedAt: 0,
		deletedAt: null,
		...overrides
	};
}

describe('partitionEligibleLiabilities', () => {
	it('excludes liabilities missing interestRate or minimumPayment (FR-008)', () => {
		const complete = liability({
			id: 'complete',
			outstandingBalance: 1000,
			interestRate: 1200,
			minimumPayment: 100
		});
		const missingRate = liability({
			id: 'missing-rate',
			outstandingBalance: 1000,
			minimumPayment: 100
		});
		const missingMinimum = liability({
			id: 'missing-minimum',
			outstandingBalance: 1000,
			interestRate: 1200
		});

		const { eligible, excludedLiabilityIds } = partitionEligibleLiabilities([
			complete,
			missingRate,
			missingMinimum
		]);

		expect(eligible).toEqual([
			{ id: 'complete', outstandingBalance: 1000, interestRate: 1200, minimumPayment: 100 }
		]);
		expect(excludedLiabilityIds.sort()).toEqual(['missing-minimum', 'missing-rate']);
	});
});

describe('generateDebtPayoffPlan', () => {
	const asOfDate = new Date(Date.UTC(2026, 0, 1)); // 2026-01-01

	it('orders debts by highest interest rate first under avalanche', () => {
		const plan = generateDebtPayoffPlan({
			liabilities: [
				{ id: 'x', outstandingBalance: 5000, interestRate: 1200, minimumPayment: 500 },
				{ id: 'y', outstandingBalance: 20000, interestRate: 3600, minimumPayment: 1000 }
			],
			strategy: 'avalanche',
			extraMonthlyPayment: 0,
			asOfDate
		});

		expect(plan.entries.map((e) => e.liabilityId)).toEqual(['y', 'x']);
		expect(plan.entries.map((e) => e.priorityOrder)).toEqual([1, 2]);
		expect(plan.entries.every((e) => !e.nonConverging)).toBe(true);
		expect(plan.payoffDate).not.toBeNull();
	});

	it('orders debts by smallest balance first under snowball', () => {
		const plan = generateDebtPayoffPlan({
			liabilities: [
				{ id: 'x', outstandingBalance: 5000, interestRate: 1200, minimumPayment: 500 },
				{ id: 'y', outstandingBalance: 20000, interestRate: 3600, minimumPayment: 1000 }
			],
			strategy: 'snowball',
			extraMonthlyPayment: 0,
			asOfDate
		});

		expect(plan.entries.map((e) => e.liabilityId)).toEqual(['x', 'y']);
		expect(plan.entries.map((e) => e.priorityOrder)).toEqual([1, 2]);
	});

	it('computes month-by-month interest and payoff date matching a hand-built amortization table', () => {
		// balance 1000 @ 12% APR (1%/mo), minimum 510, no extra:
		//   month 1: interest = round(1000*0.01) = 10, balance 1000+10-510 = 500
		//   month 2: interest = round(500*0.01)  = 5,  balance 500+5-505  = 0 (payment capped at 505)
		//   total interest = 15, payoff = 2026-03-01 (2 months after 2026-01-01)
		const plan = generateDebtPayoffPlan({
			liabilities: [
				{ id: 'loan', outstandingBalance: 1000, interestRate: 1200, minimumPayment: 510 }
			],
			strategy: 'avalanche',
			extraMonthlyPayment: 0,
			asOfDate
		});

		const [entry] = plan.entries;
		expect(entry.monthlySchedule).toEqual([
			{
				month: '2026-02-01',
				startingBalance: 1000,
				interestAccrued: 10,
				paymentApplied: 510,
				endingBalance: 500
			},
			{
				month: '2026-03-01',
				startingBalance: 500,
				interestAccrued: 5,
				paymentApplied: 505,
				endingBalance: 0
			}
		]);
		expect(entry.totalInterest).toBe(15);
		expect(entry.payoffDate).toBe('2026-03-01');
		expect(entry.nonConverging).toBe(false);
		expect(plan.totalInterest).toBe(15);
		expect(plan.payoffDate).toBe('2026-03-01');
	});

	it('flags a liability as non-converging when its minimum payment never covers accruing interest (FR-010)', () => {
		const plan = generateDebtPayoffPlan({
			liabilities: [
				{ id: 'stuck', outstandingBalance: 1000, interestRate: 100000, minimumPayment: 1 }
			],
			strategy: 'avalanche',
			extraMonthlyPayment: 0,
			asOfDate
		});

		const [entry] = plan.entries;
		expect(entry.nonConverging).toBe(true);
		expect(entry.payoffDate).toBeNull();
		expect(plan.payoffDate).toBeNull();
	});

	it('returns an empty plan when there are no eligible liabilities', () => {
		const plan = generateDebtPayoffPlan({
			liabilities: [],
			strategy: 'avalanche',
			extraMonthlyPayment: 0,
			asOfDate
		});

		expect(plan.entries).toEqual([]);
		expect(plan.payoffDate).toBeNull();
		expect(plan.totalInterest).toBe(0);
	});

	it('applies the full extra payment to the highest-priority debt, then waterfalls its minimum once paid off', () => {
		// Two debts, avalanche order: 'high' (24%) then 'low' (6%).
		// 'high': balance 1000 @ 24% (2%/mo), minimum 200, + extra 300 = 500/mo applied.
		//   month 1: interest = round(1000*0.02) = 20, balance 1000+20-500 = 520
		//   month 2: interest = round(520*0.02)  = 10, balance 520+10-500 = 30
		//   month 3: interest = round(30*0.02)   = 1,  payment capped at 31, balance 0 -> paid off
		// 'low': balance 5000 @ 6% (0.5%/mo), minimum 100, no extra until 'high' is paid off.
		//   months 1-3: only the 100 minimum applied (extra was fully consumed by 'high').
		//   month 4 onward: 'high' is gone, so its 200 minimum joins the pool -> 100+300(remaining extra)+200 = 600/mo.
		const plan = generateDebtPayoffPlan({
			liabilities: [
				{ id: 'high', outstandingBalance: 1000, interestRate: 2400, minimumPayment: 200 },
				{ id: 'low', outstandingBalance: 5000, interestRate: 600, minimumPayment: 100 }
			],
			strategy: 'avalanche',
			extraMonthlyPayment: 300,
			asOfDate
		});

		const high = plan.entries.find((e) => e.liabilityId === 'high')!;
		const low = plan.entries.find((e) => e.liabilityId === 'low')!;

		expect(high.payoffDate).toBe('2026-04-01'); // 3 months after 2026-01-01
		expect(high.monthlySchedule).toHaveLength(3);

		// Months 1-3: 'low' only received its 100 minimum (extra was on 'high').
		expect(low.monthlySchedule.slice(0, 3).map((m) => m.paymentApplied)).toEqual([100, 100, 100]);
		// Month 4: 'high' is paid off, so its 200 minimum joins the 300 extra -> 600 applied to 'low'.
		expect(low.monthlySchedule[3].paymentApplied).toBe(600);
	});
});

describe('compareStrategies', () => {
	it('returns both an avalanche and a snowball plan matching individual generateDebtPayoffPlan calls', () => {
		const input = {
			liabilities: [
				{ id: 'x', outstandingBalance: 5000, interestRate: 1200, minimumPayment: 500 },
				{ id: 'y', outstandingBalance: 20000, interestRate: 3600, minimumPayment: 1000 }
			],
			extraMonthlyPayment: 200,
			asOfDate: new Date(Date.UTC(2026, 0, 1))
		};

		const { avalanche, snowball } = compareStrategies(input);

		expect(avalanche).toEqual(generateDebtPayoffPlan({ ...input, strategy: 'avalanche' }));
		expect(snowball).toEqual(generateDebtPayoffPlan({ ...input, strategy: 'snowball' }));
		expect(avalanche.entries.map((e) => e.liabilityId)).not.toEqual(
			snowball.entries.map((e) => e.liabilityId)
		);
	});
});
