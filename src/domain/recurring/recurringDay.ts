/**
 * What `RecurringRule.dayOfPeriod` means for each frequency, and how to derive a sensible default
 * from a transaction's date. The recurring engine reads the same number three different ways, so
 * every screen that asks for it has to speak the same language: a "day 1–31" field offered for a
 * weekly or yearly rule (as the Review dialog used to) silently meant something else entirely.
 *
 * A yearly rule is a calendar date: a month (`monthOfYear`) and a day of that month
 * (`dayOfPeriod`), exactly as a monthly rule is a day of the month. It does not count days of the
 * year, which put the same date on different numbers in leap and ordinary years.
 */
import type { RecurringFrequency } from '../entities';

export interface DayRange {
	min: number;
	max: number;
	label: string;
	hint: string;
}

export const DAY_RANGE: Record<RecurringFrequency, DayRange> = {
	weekly: {
		min: 0,
		max: 6,
		label: 'Day of week',
		hint: 'Day of week, 0 (Sunday) to 6 (Saturday).'
	},
	monthly: { min: 1, max: 31, label: 'Day of month', hint: 'Day of month, 1 to 31.' },
	yearly: {
		min: 1,
		max: 31,
		label: 'Day of month',
		hint: 'Day of the month, 1 to 31, in the month chosen. 29 February falls on the 28th in other years.'
	}
};

export const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/** The most days each month can have, February counted as 29 (the engine holds it to 28 otherwise). */
const MOST_DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** Days in each month of an ordinary year, to read a rule saved as a day of the year. */
const DAYS_IN_ORDINARY_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** The last day a yearly rule can be set to in `month` (1-12). */
export function maxDayOfMonth(month: number): number {
	return MOST_DAYS_IN_MONTH[month - 1] ?? 31;
}

/**
 * The month (1-12) and day of the month a yearly rule falls on.
 *
 * A rule saved before `monthOfYear` existed holds a day of an ordinary year in `dayOfPeriod`
 * (60 is 1 March, 365 or the old 366 is 31 December); it is read as that date. Saving the rule
 * again stores the month and day directly.
 */
export function yearlyMonthDay(rule: { dayOfPeriod: number; monthOfYear?: number }): {
	month: number;
	day: number;
} {
	if (rule.monthOfYear !== undefined && rule.monthOfYear >= 1 && rule.monthOfYear <= 12) {
		return { month: rule.monthOfYear, day: Math.min(Math.max(rule.dayOfPeriod, 1), 31) };
	}
	let remaining = Math.min(Math.max(rule.dayOfPeriod, 1), 365);
	for (let index = 0; index < DAYS_IN_ORDINARY_MONTH.length; index++) {
		if (remaining <= DAYS_IN_ORDINARY_MONTH[index]) return { month: index + 1, day: remaining };
		remaining -= DAYS_IN_ORDINARY_MONTH[index];
	}
	return { month: 12, day: 31 };
}

/** "1 Mar": a yearly rule's date for a list. */
export function formatYearlyDate(month: number, day: number): string {
	return `${day} ${MONTH_NAMES[month - 1]?.slice(0, 3) ?? ''}`.trim();
}

/**
 * The `dayOfPeriod` that makes a rule recur on the same day as the ISO date `isoDate`
 * ("YYYY-MM-DD"). Calendar arithmetic in UTC, matching the engine, so it cannot shift with the
 * viewer's time zone. Falls back to the first valid day for an unparseable date. For a yearly rule
 * this is the day of the month; the month is `defaultMonthFor`.
 */
export function defaultDayFor(frequency: RecurringFrequency, isoDate: string): number {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
	if (!match) return DAY_RANGE[frequency].min;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(Date.UTC(year, month - 1, day));
	if (Number.isNaN(date.getTime())) return DAY_RANGE[frequency].min;

	if (frequency === 'weekly') return date.getUTCDay();
	return day;
}

/** The month (1-12) of an ISO date, for a yearly rule made from it; null for an unparseable date. */
export function defaultMonthFor(isoDate: string): number | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
	if (!match) return null;
	const month = Number(match[2]);
	return month >= 1 && month <= 12 ? month : null;
}

/** Clamps free input into the valid range for `frequency` (a yearly one also by its `month`). */
export function clampDay(frequency: RecurringFrequency, raw: string, month?: number): number {
	const { min } = DAY_RANGE[frequency];
	const max = frequency === 'yearly' && month ? maxDayOfMonth(month) : DAY_RANGE[frequency].max;
	const parsed = parseInt(raw, 10);
	if (!Number.isFinite(parsed)) return min;
	return Math.max(min, Math.min(max, parsed));
}
