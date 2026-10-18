import { isoDateToLocalDate } from '../shared/dateMath';
import type { BudgetPerformanceItem } from './analyticsEngine';

export interface BudgetPeriodGroup {
	id: string;
	label: string;
	items: BudgetPerformanceItem[];
}

const lastDayOfMonth = (year: number, month: number) =>
	new Date(Date.UTC(year, month, 0)).getUTCDate();

/** A budget period as people say it: "May 2026" for a calendar month, "2026" for a year, else a range. */
export function budgetPeriodLabel(periodStart: string, periodEnd: string): string {
	const [startYear, startMonth, startDay] = periodStart.split('-').map(Number);
	const [endYear, endMonth, endDay] = periodEnd.split('-').map(Number);
	const sameYear = startYear === endYear;

	if (
		sameYear &&
		startMonth === endMonth &&
		startDay === 1 &&
		endDay === lastDayOfMonth(startYear, startMonth)
	) {
		return isoDateToLocalDate(periodStart).toLocaleDateString(undefined, {
			month: 'long',
			year: 'numeric'
		});
	}
	if (sameYear && startMonth === 1 && startDay === 1 && endMonth === 12 && endDay === 31) {
		return String(startYear);
	}

	const dayMonth: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
	const from = isoDateToLocalDate(periodStart).toLocaleDateString(undefined, dayMonth);
	const to = isoDateToLocalDate(periodEnd).toLocaleDateString(undefined, {
		...dayMonth,
		year: 'numeric'
	});
	return `${from} – ${to}`;
}

/** Budget rows grouped under their period, in the order the periods first appear. */
export function groupBudgetPerformance(items: BudgetPerformanceItem[]): BudgetPeriodGroup[] {
	const groups = new Map<string, BudgetPeriodGroup>();
	for (const item of items) {
		const id = `${item.periodStart}|${item.periodEnd}`;
		const group = groups.get(id) ?? {
			id,
			label: budgetPeriodLabel(item.periodStart, item.periodEnd),
			items: []
		};
		group.items.push(item);
		groups.set(id, group);
	}
	return [...groups.values()];
}
