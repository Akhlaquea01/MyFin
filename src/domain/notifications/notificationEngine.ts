import type { NotificationCandidate } from './types';
import { localDateAsUtc } from '../shared/dateMath';
import { formatMoney } from '../shared/money';

/** The user's local calendar date `days` from `date`, as "YYYY-MM-DD". */
function addDaysISO(date: Date, days: number): string {
	const d = localDateAsUtc(date);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

export interface DueEventInput {
	id: string;
	expectedDate: string; // ISO date
	status: 'pending' | 'matched' | 'missed';
	categoryName: string;
	/** The rule's own name, and what it pays. Two rules in one category read the same by category
	 *  alone, so an alert names the rule when it has a name and says the amount. */
	label?: string;
	amount?: number;
}

/**
 * Pure — per contracts/notification-engine.md. Returns one candidate for every `pending`
 * event whose `expectedDate` falls on or before `asOfDate + leadDays` (inclusive; no lower
 * bound, since a still-`pending` overdue event is rare once `markMissedPastDue` has run,
 * but should still surface if it somehow occurs).
 */
export function findDueRecurringEvents(
	events: DueEventInput[],
	leadDays: number,
	asOfDate: Date
): NotificationCandidate[] {
	const cutoff = addDaysISO(asOfDate, leadDays);
	return events
		.filter((e) => e.status === 'pending' && e.expectedDate <= cutoff)
		.map((e) => ({
			kind: 'recurring' as const,
			key: `recurring:${e.id}`,
			title: `Upcoming: ${e.label?.trim() || e.categoryName}`,
			body:
				e.amount === undefined
					? `Due ${e.expectedDate}`
					: `Due ${e.expectedDate} · ${formatMoney(Math.abs(e.amount))}`
		}));
}

export interface BudgetThresholdInput {
	budgetId: string;
	periodStart: string; // ISO date
	plannedAmount: number; // integer, smallest currency unit
	actualAmount: number; // integer, smallest currency unit
	categoryName: string;
}

/**
 * Pure — per contracts/notification-engine.md. Returns one candidate for every item with a
 * positive `plannedAmount` whose spend ratio has reached `thresholdPercent`.
 */
export function findCrossedBudgetThresholds(
	items: BudgetThresholdInput[],
	thresholdPercent: number
): NotificationCandidate[] {
	return items
		.filter(
			(i) => i.plannedAmount > 0 && (i.actualAmount / i.plannedAmount) * 100 >= thresholdPercent
		)
		.map((i) => {
			const percentUsed = Math.round((i.actualAmount / i.plannedAmount) * 100);
			return {
				kind: 'budget' as const,
				key: `budget:${i.budgetId}:${i.periodStart}:${thresholdPercent}`,
				title: `${i.categoryName} budget`,
				body: `${percentUsed}% used`
			};
		});
}
