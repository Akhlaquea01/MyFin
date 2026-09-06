import type { NotificationCandidate } from './types';

function addDaysISO(date: Date, days: number): string {
	const d = new Date(date);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
}

export interface DueEventInput {
	id: string;
	expectedDate: string; // ISO date
	status: 'pending' | 'matched' | 'missed';
	categoryName: string;
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
			title: `Upcoming: ${e.categoryName}`,
			body: `Due ${e.expectedDate}`
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
