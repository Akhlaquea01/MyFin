import { describe, it, expect } from 'vitest';
import {
	getCurrentPeriodRange,
	getPreviousPeriodRange
} from '../../src/domain/budgets/budgetEngine';

describe('getCurrentPeriodRange', () => {
	it('bounds a monthly period to the containing calendar month', () => {
		const range = getCurrentPeriodRange('monthly', new Date(2026, 8, 15, 12, 0)); // 15 Sep
		expect(range).toEqual({ periodStart: '2026-09-01', periodEnd: '2026-09-30' });
	});

	it('handles month lengths and leap years', () => {
		expect(getCurrentPeriodRange('monthly', new Date(2026, 1, 10)).periodEnd).toBe('2026-02-28');
		expect(getCurrentPeriodRange('monthly', new Date(2028, 1, 10)).periodEnd).toBe('2028-02-29');
		expect(getCurrentPeriodRange('monthly', new Date(2026, 0, 10)).periodEnd).toBe('2026-01-31');
	});

	it('bounds a yearly period to the calendar year', () => {
		expect(getCurrentPeriodRange('yearly', new Date(2026, 5, 15))).toEqual({
			periodStart: '2026-01-01',
			periodEnd: '2026-12-31'
		});
	});

	/**
	 * Regression: period bounds were computed with UTC accessors (`getUTCMonth`) while every
	 * stored transaction date comes from `<input type="date">`, which yields the user's *local*
	 * calendar day. East of UTC the two disagreed at the month boundary: in IST (UTC+5:30),
	 * 1 September 02:00 local is 31 August 20:30 UTC, so for the first 5.5 hours of every month
	 * new spending was measured against the previous month's budget — and the on-unlock
	 * notification check compared thresholds for the wrong period entirely.
	 *
	 * Constructing the Date from local components is exactly what `new Date()` produces at that
	 * wall-clock moment, so this reproduces the skew in whatever zone the runner is in.
	 */
	it('uses the local calendar day, matching how transaction dates are recorded', () => {
		// Just after local midnight on the 1st — the case that used to fall into August.
		const justAfterMidnight = new Date(2026, 8, 1, 0, 30);
		expect(getCurrentPeriodRange('monthly', justAfterMidnight).periodStart).toBe('2026-09-01');

		// Just before local midnight on the last day — must stay in September.
		const justBeforeMidnight = new Date(2026, 8, 30, 23, 30);
		expect(getCurrentPeriodRange('monthly', justBeforeMidnight).periodStart).toBe('2026-09-01');
		expect(getCurrentPeriodRange('monthly', justBeforeMidnight).periodEnd).toBe('2026-09-30');
	});

	it('agrees with the date string an input[type=date] would produce on the same day', () => {
		const localDay = new Date(2026, 8, 1, 3, 0);
		const asInputWouldWriteIt = `${localDay.getFullYear()}-${String(localDay.getMonth() + 1).padStart(2, '0')}-${String(localDay.getDate()).padStart(2, '0')}`;
		const range = getCurrentPeriodRange('monthly', localDay);
		expect(asInputWouldWriteIt >= range.periodStart).toBe(true);
		expect(asInputWouldWriteIt <= range.periodEnd).toBe(true);
	});
});

describe('getPreviousPeriodRange', () => {
	it('steps back one month, including across a year boundary', () => {
		expect(getPreviousPeriodRange('monthly', '2026-09-01')).toEqual({
			periodStart: '2026-08-01',
			periodEnd: '2026-08-31'
		});
		expect(getPreviousPeriodRange('monthly', '2026-01-01')).toEqual({
			periodStart: '2025-12-01',
			periodEnd: '2025-12-31'
		});
	});

	it('steps back one year', () => {
		expect(getPreviousPeriodRange('yearly', '2026-01-01')).toEqual({
			periodStart: '2025-01-01',
			periodEnd: '2025-12-31'
		});
	});

	it('can be chained to walk back over skipped periods', () => {
		// What `ensureCurrentBudgetItem` does when the user hasn't opened the app for months.
		let cursor = getPreviousPeriodRange('monthly', '2026-09-01');
		for (let i = 0; i < 3; i++) cursor = getPreviousPeriodRange('monthly', cursor.periodStart);
		expect(cursor.periodStart).toBe('2026-05-01');
	});
});
