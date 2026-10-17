/**
 * Whole-month date arithmetic shared by the debt payoff planner (spec 002) and savings
 * goals (spec 003) engines. UTC throughout to avoid timezone drift; day-of-month is always
 * normalized to the 1st, since neither engine needs day-level precision.
 */

/**
 * Today's date as "YYYY-MM-DD" in the user's *local* calendar. This is deliberately NOT UTC:
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which in India (UTC+5:30) is still
 * "yesterday" for the first 5½ hours of every day — so a transaction entered at 8 AM defaulted to
 * the previous date, landing in the wrong month on the 1st. Every `<input type="date">` and
 * every record stamped "now" should use this instead.
 */
export function todayLocalISO(now: Date = new Date()): string {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * A `Date` at UTC midnight on the user's *local* calendar date. The recurring engines do their
 * calendar arithmetic with the UTC accessors, so handing them a plain `new Date()` made "today"
 * the UTC date — yesterday, for the first 5½ hours of every day in India.
 */
export function localDateAsUtc(now: Date = new Date()): Date {
	return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * A `Date` at LOCAL midnight on the calendar day "YYYY-MM-DD" names, for formatting with the
 * locale methods. `new Date('2026-12-01')` is midnight UTC instead — still 30 November anywhere
 * behind UTC — so a stored date that was formatted that way showed up a day (or a month) early.
 */
export function isoDateToLocalDate(iso: string): Date {
	return new Date(`${iso}T00:00:00`);
}

/**
 * Whether `value` is a real calendar date written "YYYY-MM-DD". An empty `<input type="date">`
 * yields "", and `new Date('2026-02-31')` rolls forward instead of failing — either one stored
 * as a transaction date drops the entry out of every period query and report.
 */
export function isValidIsoDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	return (
		parsed.getUTCFullYear() === year &&
		parsed.getUTCMonth() === month - 1 &&
		parsed.getUTCDate() === day
	);
}

/** `iso` shifted by `deltaDays` whole days (negative = earlier). Calendar arithmetic only — no
 *  timezone is involved, so it cannot drift across a DST change. Returns `iso` unchanged if it
 *  is not a valid date. */
export function addDaysISO(iso: string, deltaDays: number): string {
	const parsed = new Date(`${iso}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return iso;
	parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
	return parsed.toISOString().slice(0, 10);
}

/** First-of-month ISO date, `monthsToAdd` months after `date`. */
export function addMonthsISO(date: Date, monthsToAdd: number): string {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthsToAdd, 1));
	return d.toISOString().slice(0, 10);
}

/** Whole calendar months between two ISO dates (`to` − `from`); ignores day-of-month. */
export function monthsBetween(fromISO: string, toISO: string): number {
	const from = new Date(fromISO);
	const to = new Date(toISO);
	return (
		(to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
	);
}
