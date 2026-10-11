import { describe, it, expect } from 'vitest';
import { addDaysISO, todayLocalISO } from '../../src/domain/shared/dateMath';

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
