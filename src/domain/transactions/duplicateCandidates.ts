import { TransactionRepository } from '../../data/dexie/transactionRepository';
import type { Merchant, Transaction } from '../entities';

export interface DuplicateQuery {
	/** `null` looks across every account, for an entry whose account was only guessed. */
	accountId: string | null;
	/** Signed minor units (negative = expense), exactly as it would be stored. */
	amount: number;
	date: string;
}

/** Why an existing entry looks like the same payment, strongest first. */
export type DuplicateReason = 'same-reference' | 'same-merchant' | 'same-amount';

/** A reference number reaches further than the day window: the same UPI/UTR is the same payment. */
const REFERENCE_WINDOW_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysApart(a: string, b: string): number {
	return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;
}

/** What ties `duplicate` to `original`, for the line Review shows beside the flag. */
export function duplicateReason(original: Transaction, duplicate: Transaction): DuplicateReason {
	const ref = duplicate.capture?.refNo;
	if (ref && original.capture?.refNo === ref) return 'same-reference';
	if (duplicate.merchantId && duplicate.merchantId === original.merchantId) return 'same-merchant';
	return 'same-amount';
}

/** Captured entries carrying `refNo` with this amount, whatever their account or review state. */
export async function findByReference(
	key: CryptoKey,
	refNo: string,
	amount: number,
	date: string
): Promise<Transaction[]> {
	const found = await TransactionRepository.findPossibleDuplicates(
		key,
		null,
		amount,
		date,
		REFERENCE_WINDOW_DAYS
	);
	return found.filter((tx) => tx.capture?.refNo === refNo);
}

/**
 * Existing entries a new one would plausibly duplicate: same signed amount, date within a day
 * (the same rule file and bulk import already use — `findPossibleDuplicates`) on the same account,
 * plus anything carrying the same reference number up to five days apart. Ranked so the likeliest
 * comes first: same reference, then same merchant, then same date, then most recent. Pasting the
 * same bank SMS twice — or an SMS for something already entered by hand — is the case this exists
 * for.
 *
 * Deliberately a *warning* input, not a rule: two ₹50 teas on one day are two real transactions,
 * so the caller shows the match and lets the user decide.
 */
export async function findDuplicateCandidates(
	key: CryptoKey,
	query: DuplicateQuery,
	options: {
		merchantName?: string;
		/** Preferred over `merchantName` when the merchant is already resolved. */
		merchantId?: string | null;
		merchants?: Merchant[];
		refNo?: string | null;
		limit?: number;
	} = {}
): Promise<Transaction[]> {
	const { refNo } = options;
	const found = await TransactionRepository.findPossibleDuplicates(
		key,
		query.accountId,
		query.amount,
		query.date,
		refNo ? REFERENCE_WINDOW_DAYS : 1
	);
	const sameRef = (tx: Transaction) => !!refNo && tx.capture?.refNo === refNo;
	const matches = found.filter((tx) => sameRef(tx) || daysApart(tx.date, query.date) <= 1);

	const wantedName = options.merchantName?.trim().toLowerCase() ?? '';
	const nameById = new Map(
		(options.merchants ?? []).map((m) => [m.id, m.name.trim().toLowerCase()])
	);
	const sameMerchant = (tx: Transaction) => {
		if (!tx.merchantId) return false;
		if (options.merchantId) return tx.merchantId === options.merchantId;
		return wantedName !== '' && nameById.get(tx.merchantId) === wantedName;
	};

	return matches
		.sort(
			(a, b) =>
				Number(sameRef(b)) - Number(sameRef(a)) ||
				Number(sameMerchant(b)) - Number(sameMerchant(a)) ||
				Number(b.date === query.date) - Number(a.date === query.date) ||
				b.date.localeCompare(a.date) ||
				b.createdAt - a.createdAt
		)
		.slice(0, options.limit ?? 3);
}
