import { formatMoney } from '../domain/shared/money';

// Net worth is recorded daily, so the series runs to thousands of points: far too many to read out
// as a chart's accessible name. Past this many, the two ends say enough.
const MAX_LISTED_POINTS = 12;

export function describeNetWorthSeries(points: { date: string; netWorth: number }[]): string {
	if (points.length <= MAX_LISTED_POINTS) {
		return points.map((p) => `${p.date} ${formatMoney(p.netWorth)}`).join(', ');
	}
	const first = points[0];
	const last = points[points.length - 1];
	return `${points.length} days, from ${formatMoney(first.netWorth)} on ${first.date} to ${formatMoney(last.netWorth)} on ${last.date}`;
}
