import { describe, it, expect } from 'vitest';
import { clampDay, defaultDayFor, DAY_RANGE } from '../../src/domain/recurring/recurringDay';

describe('defaultDayFor', () => {
	it('uses the day of the month for monthly rules', () => {
		expect(defaultDayFor('monthly', '2026-03-17')).toBe(17);
	});

	it('uses the weekday (0 = Sunday) for weekly rules', () => {
		expect(defaultDayFor('weekly', '2026-10-11')).toBe(0); // a Sunday
		expect(defaultDayFor('weekly', '2026-10-12')).toBe(1); // Monday
		expect(defaultDayFor('weekly', '2026-10-17')).toBe(6); // Saturday
	});

	it('uses the day of the year for yearly rules, counting leap years', () => {
		expect(defaultDayFor('yearly', '2026-01-01')).toBe(1);
		expect(defaultDayFor('yearly', '2026-12-31')).toBe(365);
		expect(defaultDayFor('yearly', '2028-12-31')).toBe(366);
		expect(defaultDayFor('yearly', '2028-03-01')).toBe(61);
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
	});
});
