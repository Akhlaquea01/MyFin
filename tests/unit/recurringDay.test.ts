import { describe, it, expect } from 'vitest';
import {
	clampDay,
	defaultDayFor,
	defaultMonthFor,
	formatYearlyDate,
	maxDayOfMonth,
	yearlyMonthDay,
	DAY_RANGE
} from '../../src/domain/recurring/recurringDay';

describe('defaultDayFor', () => {
	it('uses the day of the month for monthly rules', () => {
		expect(defaultDayFor('monthly', '2026-03-17')).toBe(17);
	});

	it('uses the weekday (0 = Sunday) for weekly rules', () => {
		expect(defaultDayFor('weekly', '2026-10-11')).toBe(0); // a Sunday
		expect(defaultDayFor('weekly', '2026-10-12')).toBe(1); // Monday
		expect(defaultDayFor('weekly', '2026-10-17')).toBe(6); // Saturday
	});

	it('uses the day of the month for yearly rules, with the month alongside', () => {
		expect(defaultDayFor('yearly', '2026-03-01')).toBe(1);
		expect(defaultDayFor('yearly', '2028-12-31')).toBe(31);
		expect(defaultDayFor('yearly', '2028-02-29')).toBe(29);
		expect(defaultMonthFor('2026-03-01')).toBe(3);
		expect(defaultMonthFor('2028-12-31')).toBe(12);
		expect(defaultMonthFor('nope')).toBeNull();
	});

	it('falls back to the first valid day for an unparseable date', () => {
		expect(defaultDayFor('weekly', 'nope')).toBe(0);
		expect(defaultDayFor('monthly', '')).toBe(1);
	});
});

describe('clampDay', () => {
	it('keeps a valid value and clamps the rest into range', () => {
		expect(clampDay('monthly', '15')).toBe(15);
		expect(clampDay('monthly', '99')).toBe(DAY_RANGE.monthly.max);
		expect(clampDay('monthly', '0')).toBe(1);
		expect(clampDay('weekly', '9')).toBe(6);
		expect(clampDay('yearly', 'abc')).toBe(1);
		expect(clampDay('yearly', '99')).toBe(DAY_RANGE.yearly.max);
		// A yearly day is also held to its month.
		expect(clampDay('yearly', '31', 4)).toBe(30);
		expect(clampDay('yearly', '31', 2)).toBe(29);
	});
});

describe('yearlyMonthDay', () => {
	it('reads a rule that stores its month and day directly', () => {
		expect(yearlyMonthDay({ dayOfPeriod: 1, monthOfYear: 3 })).toEqual({ month: 3, day: 1 });
		expect(yearlyMonthDay({ dayOfPeriod: 29, monthOfYear: 2 })).toEqual({ month: 2, day: 29 });
	});

	it('reads a rule saved as a day of an ordinary year as that date', () => {
		expect(yearlyMonthDay({ dayOfPeriod: 1 })).toEqual({ month: 1, day: 1 });
		expect(yearlyMonthDay({ dayOfPeriod: 59 })).toEqual({ month: 2, day: 28 });
		expect(yearlyMonthDay({ dayOfPeriod: 60 })).toEqual({ month: 3, day: 1 });
		expect(yearlyMonthDay({ dayOfPeriod: 365 })).toEqual({ month: 12, day: 31 });
		// The range used to run to 366: that was always the end of the year.
		expect(yearlyMonthDay({ dayOfPeriod: 366 })).toEqual({ month: 12, day: 31 });
	});
});

describe('yearly dates', () => {
	it('knows how many days a month can have, February counted as 29', () => {
		expect(maxDayOfMonth(1)).toBe(31);
		expect(maxDayOfMonth(2)).toBe(29);
		expect(maxDayOfMonth(4)).toBe(30);
	});

	it('writes a date for a list', () => {
		expect(formatYearlyDate(3, 1)).toBe('1 Mar');
		expect(formatYearlyDate(12, 31)).toBe('31 Dec');
	});
});
