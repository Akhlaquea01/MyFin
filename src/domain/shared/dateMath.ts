/**
 * Whole-month date arithmetic shared by the debt payoff planner (spec 002) and savings
 * goals (spec 003) engines. UTC throughout to avoid timezone drift; day-of-month is always
 * normalized to the 1st, since neither engine needs day-level precision (see
 * specs/003-savings-goals/research.md §2).
 */

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
