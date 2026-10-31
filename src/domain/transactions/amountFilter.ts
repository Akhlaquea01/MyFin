import { parseMoneyToMinorUnits } from '../shared/money';

export interface AmountRange {
	/** Smallest absolute amount to show, in minor units. */
	min?: number;
	max?: number;
}

export type AmountRangeResult = ({ ok: true } & AmountRange) | { ok: false; message: string };

function parseBound(raw: string): number | undefined | null {
	if (raw.trim() === '') return undefined;
	const minor = parseMoneyToMinorUnits(raw);
	// Direction is not part of the filter (income and expense both count), so a sign is a typo.
	return minor === null || minor < 0 ? null : minor;
}

/** Reads the two filter boxes. A blank box leaves that side open. */
export function parseAmountRange(minRaw: string, maxRaw: string): AmountRangeResult {
	const min = parseBound(minRaw);
	if (min === null)
		return { ok: false, message: 'Enter the minimum amount as a number, like 500 or 1,250.50.' };
	const max = parseBound(maxRaw);
	if (max === null)
		return { ok: false, message: 'Enter the maximum amount as a number, like 500 or 1,250.50.' };
	if (min !== undefined && max !== undefined && min > max) {
		return { ok: false, message: 'The minimum amount is higher than the maximum.' };
	}
	return { ok: true, min, max };
}

/** Whether a transaction's size, ignoring whether it is money in or out, is inside the range. */
export function withinAmountRange(amount: number, { min, max }: AmountRange): boolean {
	const size = Math.abs(amount);
	return (min === undefined || size >= min) && (max === undefined || size <= max);
}
