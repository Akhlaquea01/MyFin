/**
 * Turns the category rows on the New Transaction form into the splits that get stored — or says
 * plainly why they cannot be.
 *
 * Pure — no I/O, no framework. The form used to drop any row that had a category but no amount,
 * which silently discarded a category the user had explicitly picked, and let the storage layer
 * reject a mismatched total with a message in raw paise. Both are decided here, in the user's
 * terms, before anything is written.
 */
import { formatMoney, isPositiveMoney, parseMoneyOrZero } from '../shared/money';

export interface SplitRowInput {
	categoryId: string;
	amountInput: string;
}

export interface UnsignedSplit {
	categoryId: string;
	/** Positive minor units; the caller applies the transaction's sign. */
	amount: number;
}

export type SplitAnalysis = { ok: true; splits: UnsignedSplit[] } | { ok: false; message: string };

/**
 * `totalMinor` is the transaction's unsigned total. An empty result means "no split": the whole
 * amount is left for auto-categorization or Review.
 */
export function analyzeSplits(rows: SplitRowInput[], totalMinor: number): SplitAnalysis {
	const filled = rows.filter((r) => r.categoryId || r.amountInput.trim() !== '');
	if (filled.length === 0) return { ok: true, splits: [] };

	// One category and no amount means "all of it" — the common case, which should not need the
	// total typed a second time.
	if (filled.length === 1 && filled[0].categoryId && filled[0].amountInput.trim() === '') {
		return { ok: true, splits: [{ categoryId: filled[0].categoryId, amount: totalMinor }] };
	}

	if (filled.some((r) => !r.categoryId)) {
		return { ok: false, message: 'Choose a category for every amount you entered.' };
	}
	if (filled.some((r) => !isPositiveMoney(r.amountInput))) {
		return {
			ok: false,
			message:
				'Enter an amount for every category you chose, or leave a single category’s amount blank to use the whole total.'
		};
	}

	const splits = filled.map((r) => ({
		categoryId: r.categoryId,
		amount: parseMoneyOrZero(r.amountInput)
	}));
	const sum = splits.reduce((t, s) => t + s.amount, 0);
	if (sum !== totalMinor) {
		const difference = Math.abs(totalMinor - sum);
		return {
			ok: false,
			message:
				sum < totalMinor
					? `The categories add up to ${formatMoney(sum)} but the total is ${formatMoney(totalMinor)} — ${formatMoney(difference)} still to allocate.`
					: `The categories add up to ${formatMoney(sum)} but the total is ${formatMoney(totalMinor)} — ${formatMoney(difference)} too much.`
		};
	}
	return { ok: true, splits };
}

/** How much of `totalMinor` the typed split amounts cover so far, for a running "x of y" hint. */
export function allocatedMinor(rows: SplitRowInput[]): number {
	return rows.reduce(
		(t, r) => t + (isPositiveMoney(r.amountInput) ? parseMoneyOrZero(r.amountInput) : 0),
		0
	);
}
