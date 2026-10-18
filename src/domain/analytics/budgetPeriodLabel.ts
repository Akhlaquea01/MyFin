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

/** Years to offer in a year picker: every year a budget period touches, plus the current one. Newest first. */
export function budgetYears(items: BudgetPerformanceItem[], currentYear: number): number[] {
	const years = new Set([currentYear]);
	for (const item of items) {
		years.add(Number(item.periodStart.slice(0, 4)));
		years.add(Number(item.periodEnd.slice(0, 4)));
	}
	return [...years].filter(Number.isFinite).sort((a, b) => b - a);
}

/** Rows whose period overlaps the calendar month (1-12): a yearly budget shows in each of its months. */
export function budgetPerformanceInMonth(
	items: BudgetPerformanceItem[],
	year: number,
	month: number
): BudgetPerformanceItem[] {
	const prefix = `${year}-${String(month).padStart(2, '0')}`;
	const start = `${prefix}-01`;
	const end = `${prefix}-${String(lastDayOfMonth(year, month)).padStart(2, '0')}`;
	return items.filter((item) => item.periodEnd >= start && item.periodStart <= end);
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
