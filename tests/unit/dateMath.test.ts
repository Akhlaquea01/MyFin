import { afterEach, describe, it, expect } from 'vitest';
import {
	addDaysISO,
	addMonthsISO,
	isoDateToLocalDate,
	isValidIsoDate,
	localDateAsUtc,
	todayLocalISO
} from '../../src/domain/shared/dateMath';

describe('todayLocalISO', () => {
	it('uses the local calendar date, not the UTC date', () => {
		// 01:30 local on 1 January. In any timezone ahead of UTC (India, +5:30) the UTC date is still
		// 31 December — the exact moment `toISOString().slice(0, 10)` returns the wrong day.
		const earlyMorning = new Date(2026, 0, 1, 1, 30);
		expect(todayLocalISO(earlyMorning)).toBe('2026-01-01');
	});

	it('uses the local calendar date late in the evening too', () => {
		// 23:30 local on 31 January is already 1 February in UTC for any timezone behind UTC.
		const lateEvening = new Date(2026, 0, 31, 23, 30);
		expect(todayLocalISO(lateEvening)).toBe('2026-01-31');
	});

	it('zero-pads month and day', () => {
		expect(todayLocalISO(new Date(2026, 2, 5, 12, 0))).toBe('2026-03-05');
	});
});

describe('addDaysISO', () => {
	it('moves forward and backward across month and year boundaries', () => {
		expect(addDaysISO('2026-01-31', 1)).toBe('2026-02-01');
		expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31');
		expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
		expect(addDaysISO('2028-03-01', -1)).toBe('2028-02-29');
	});

	it('returns an invalid date unchanged', () => {
		expect(addDaysISO('not-a-date', 3)).toBe('not-a-date');
	});
});

describe('localDateAsUtc', () => {
	it('has the local calendar date in its UTC fields, whatever the time zone', () => {
		// 01:30 local on 1 January: ahead of UTC the UTC date is still 31 December.
		const earlyMorning = localDateAsUtc(new Date(2026, 0, 1, 1, 30));
		expect(earlyMorning.toISOString().slice(0, 10)).toBe('2026-01-01');
		const lateEvening = localDateAsUtc(new Date(2026, 0, 31, 23, 30));
		expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-01-31');
	});

	it('is midnight UTC', () => {
		expect(localDateAsUtc(new Date(2026, 5, 15, 17, 45)).toISOString()).toBe(
			'2026-06-15T00:00:00.000Z'
		);
	});
});

describe('time-zone hazards of calendar dates', () => {
	const originalTz = process.env.TZ;
	afterEach(() => {
		if (originalTz === undefined) delete process.env.TZ;
		else process.env.TZ = originalTz;
	});

	it('isoDateToLocalDate names the same calendar day behind UTC, where a plain parse is a day early', () => {
		process.env.TZ = 'America/New_York';
		// `new Date('2026-12-01')` is midnight UTC: still 30 November in New York, so a page that
		// formatted it showed "November 2026" for a December payoff date.
		expect(new Date('2026-12-01').getDate()).toBe(30);
		const day = isoDateToLocalDate('2026-12-01');
		expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 11, 1]);
	});

	it('isoDateToLocalDate is the same day ahead of UTC too', () => {
		process.env.TZ = 'Asia/Kolkata';
		const day = isoDateToLocalDate('2026-12-01');
		expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 11, 1]);
	});

	it('month arithmetic from a plain `new Date()` is a month early for the first hours of the month in India', () => {
		process.env.TZ = 'Asia/Kolkata';
		const justAfterMidnight = new Date('2026-10-31T21:00:00Z'); // 02:30 on 1 November in India
		expect(addMonthsISO(justAfterMidnight, 1)).toBe('2026-11-01');
		// Handed the local calendar day instead (as the planner and goal projection now do), it is right.
		expect(addMonthsISO(localDateAsUtc(justAfterMidnight), 1)).toBe('2026-12-01');
	});
});

describe('isValidIsoDate', () => {
	it('accepts real calendar dates, including a leap day', () => {
		expect(isValidIsoDate('2026-03-05')).toBe(true);
		expect(isValidIsoDate('2028-02-29')).toBe(true);
	});

	it('rejects what an emptied date input or a bad import produces', () => {
		expect(isValidIsoDate('')).toBe(false);
		expect(isValidIsoDate('2026-02-31')).toBe(false);
		expect(isValidIsoDate('2026-02-29')).toBe(false);
		expect(isValidIsoDate('2026-13-01')).toBe(false);
		expect(isValidIsoDate('05/03/2026')).toBe(false);
		expect(isValidIsoDate('2026-3-5')).toBe(false);
		expect(isValidIsoDate('0050-03-05')).toBe(false);
	});
});
