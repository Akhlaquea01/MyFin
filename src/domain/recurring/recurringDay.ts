/**
 * What `RecurringRule.dayOfPeriod` means for each frequency, and how to derive a sensible default
 * from a transaction's date. The recurring engine reads the same number three different ways, so
 * every screen that asks for it has to speak the same language: a "day 1–31" field offered for a
 * weekly or yearly rule (as the Review dialog used to) silently meant something else entirely.
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
	yearly: { min: 1, max: 366, label: 'Day of year', hint: 'Day of year, 1 to 366.' }
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The `dayOfPeriod` that makes a rule recur on the same day as the ISO date `isoDate`
 * ("YYYY-MM-DD"). Calendar arithmetic in UTC, matching the engine, so it cannot shift with the
 * viewer's time zone. Falls back to the first valid day for an unparseable date.
 */
export function defaultDayFor(frequency: RecurringFrequency, isoDate: string): number {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
	if (!match) return DAY_RANGE[frequency].min;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(Date.UTC(year, month - 1, day));
	if (Number.isNaN(date.getTime())) return DAY_RANGE[frequency].min;

	if (frequency === 'weekly') return date.getUTCDay();
	if (frequency === 'monthly') return day;
	return Math.floor((date.getTime() - Date.UTC(year, 0, 1)) / DAY_MS) + 1;
}

/** Clamps free input into the valid range for `frequency`. */
export function clampDay(frequency: RecurringFrequency, raw: string): number {
	const { min, max } = DAY_RANGE[frequency];
	const parsed = parseInt(raw, 10);
	if (!Number.isFinite(parsed)) return min;
	return Math.max(min, Math.min(max, parsed));
}
