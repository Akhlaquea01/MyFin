import { describe, it, expect } from 'vitest';
import { computeGoalProgress } from '../../src/domain/savingsGoals/goalProgress';

const asOfDate = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01

function goal(overrides: { targetAmount: number; targetDate?: string | null }) {
	return {
		id: 'goal-1',
		targetAmount: overrides.targetAmount,
		targetDate: overrides.targetDate ?? null
	};
}

describe('computeGoalProgress', () => {
	it('sums contributions (including a negative correction) into savedAmount', () => {
		const progress = computeGoalProgress({
			goal: goal({ targetAmount: 10000 }),
			contributions: [
				{ amount: 3000, date: '2026-05-01' },
				{ amount: 2000, date: '2026-06-01' },
				{ amount: -500, date: '2026-06-01' }
			],
			asOfDate
		});
		expect(progress.savedAmount).toBe(4500);
		expect(progress.progressPercent).toBe(45);
		expect(progress.achieved).toBe(false);
	});

	it('marks a goal achieved once saved reaches or exceeds the target, including overshoot', () => {
		const progress = computeGoalProgress({
			goal: goal({ targetAmount: 10000 }),
			contributions: [
				{ amount: 5000, date: '2026-05-01' },
				{ amount: 6000, date: '2026-06-01' }
			],
			asOfDate
		});
		expect(progress.savedAmount).toBe(11000);
		expect(progress.progressPercent).toBe(110);
		expect(progress.achieved).toBe(true);
		expect(progress.status).toBe('achieved');
		expect(progress.projectedCompletionDate).toBeNull();
	});

	it('does not round a goal that is not yet met up to 100%', () => {
		const progress = computeGoalProgress({
			goal: goal({ targetAmount: 100000 }),
			contributions: [{ amount: 99600, date: '2026-01-01' }],
			asOfDate
		});
		expect(progress.achieved).toBe(false);
		expect(progress.progressPercent).toBe(99);
	});

	it('floors progressPercent at 0 rather than going negative when corrections overshoot the total', () => {
		const progress = computeGoalProgress({
			goal: goal({ targetAmount: 10000 }),
			contributions: [
				{ amount: 3000, date: '2026-05-01' },
				{ amount: -5000, date: '2026-06-01' }
			],
			asOfDate
		});
		expect(progress.savedAmount).toBe(-2000);
		expect(progress.progressPercent).toBe(0);
		expect(progress.achieved).toBe(false);
	});

	it('reports insufficient-data with fewer than two contributions', () => {
		const progress = computeGoalProgress({
			goal: goal({ targetAmount: 10000 }),
			contributions: [{ amount: 500, date: '2026-06-01' }],
			asOfDate
		});
		expect(progress.status).toBe('insufficient-data');
		expect(progress.projectedCompletionDate).toBeNull();
	});

	it('reports insufficient-data when the contribution span is zero whole months', () => {
		const progress = computeGoalProgress({
			goal: goal({ targetAmount: 10000 }),
			contributions: [
				{ amount: 500, date: '2026-06-01' },
				{ amount: 500, date: '2026-06-15' }
			],
			asOfDate
		});
		expect(progress.status).toBe('insufficient-data');
		expect(progress.projectedCompletionDate).toBeNull();
	});

	it('computes a projected completion date from the average monthly rate (research.md §1)', () => {
		// 1000 on the first day, then 1000 two months later -> 500/mo (the first deposit starts the
		// clock); remaining 10000 -> 20 months from asOfDate.
		const progress = computeGoalProgress({
			goal: goal({ targetAmount: 12000, targetDate: '2026-09-01' }), // 3 months out
			contributions: [
				{ amount: 1000, date: '2026-04-01' },
				{ amount: 1000, date: '2026-06-01' }
			],
			asOfDate
		});
		expect(progress.savedAmount).toBe(2000);
		expect(progress.projectedCompletionDate).toBe('2028-02-01'); // asOfDate + 20 months
		expect(progress.status).toBe('behind'); // projection (20mo) later than target (3mo)
	});

	it('classifies on-track when the projection meets or beats the target date', () => {
		// 1000 on the first day, then 6000 two months later -> rate 3000/mo; remaining 5000 -> 2
		// months from asOfDate.
		const progress = computeGoalProgress({
			goal: goal({ targetAmount: 12000, targetDate: '2026-09-01' }), // 3 months out
			contributions: [
				{ amount: 1000, date: '2026-04-01' },
				{ amount: 1000, date: '2026-06-01' },
				{ amount: 5000, date: '2026-06-01' }
			],
			asOfDate
		});
		expect(progress.savedAmount).toBe(7000);
		expect(progress.projectedCompletionDate).toBe('2026-08-01'); // asOfDate + 2 months
		expect(progress.status).toBe('on-track');
	});

	it('reads regular deposits at their real pace, not one deposit faster', () => {
		// 1000 a month for four months (Jan 1 to Apr 1): 4000 saved, but only 3000 of it came in after
		// the clock started, over 3 months -> 1000/mo, not 4000/3 = 1333/mo. Remaining 6000 -> 6 months.
		const progress = computeGoalProgress({
			goal: goal({ targetAmount: 10000 }),
			contributions: [
				{ amount: 1000, date: '2026-01-01' },
				{ amount: 1000, date: '2026-02-01' },
				{ amount: 1000, date: '2026-03-01' },
				{ amount: 1000, date: '2026-04-01' }
			],
			asOfDate
		});
		expect(progress.projectedCompletionDate).toBe('2026-12-01'); // asOfDate (June) + 6 months
	});

	it('has no pace when everything was saved on the first day', () => {
		const progress = computeGoalProgress({
			goal: goal({ targetAmount: 10000 }),
			contributions: [
				{ amount: 1000, date: '2026-01-01' },
				{ amount: 2000, date: '2026-01-01' }
			],
			asOfDate
		});
		expect(progress.projectedCompletionDate).toBeNull();
		expect(progress.status).toBe('insufficient-data');
	});

	it('classifies on-track (no target date to be behind against) when a projection exists but there is no target date', () => {
		const progress = computeGoalProgress({
			goal: goal({ targetAmount: 12000, targetDate: null }),
			contributions: [
				{ amount: 1000, date: '2026-04-01' },
				{ amount: 1000, date: '2026-06-01' }
			],
			asOfDate
		});
		expect(progress.projectedCompletionDate).not.toBeNull();
		expect(progress.status).toBe('on-track');
	});

	it('reports insufficient-data (not a nonsensical date) when the average rate is zero or negative', () => {
		// saved 1000 - 1500 = -500 over a 2-month span -> non-positive rate.
		const progress = computeGoalProgress({
			goal: goal({ targetAmount: 12000, targetDate: '2026-09-01' }),
			contributions: [
				{ amount: 1000, date: '2026-04-01' },
				{ amount: -1500, date: '2026-06-01' }
			],
			asOfDate
		});
		expect(progress.status).toBe('insufficient-data');
		expect(progress.projectedCompletionDate).toBeNull();
	});
});
