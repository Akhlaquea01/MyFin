import { TransactionRepository } from '../../data/dexie/transactionRepository';
import type { Merchant, Transaction } from '../entities';

export interface DuplicateQuery {
	accountId: string;
	/** Signed minor units (negative = expense), exactly as it would be stored. */
	amount: number;
	date: string;
}

/**
 * Existing entries a new one would plausibly duplicate: same account, same signed amount, date
 * within a day (the same rule file and bulk import already use — `findPossibleDuplicates`), ranked
 * so the likeliest comes first: same merchant, then same date, then most recent. Pasting the same
 * bank SMS twice — or an SMS for something already entered by hand — is the case this exists for.
 *
 * Deliberately a *warning* input, not a rule: two ₹50 teas on one day are two real transactions,
 * so the caller shows the match and lets the user decide.
 */
export async function findDuplicateCandidates(
	key: CryptoKey,
	query: DuplicateQuery,
	options: { merchantName?: string; merchants?: Merchant[]; limit?: number } = {}
): Promise<Transaction[]> {
	const matches = await TransactionRepository.findPossibleDuplicates(
		key,
		query.accountId,
		query.amount,
		query.date
	);
	const wantedName = options.merchantName?.trim().toLowerCase() ?? '';
	const nameById = new Map(
		(options.merchants ?? []).map((m) => [m.id, m.name.trim().toLowerCase()])
	);

	const sameMerchant = (tx: Transaction) =>
		wantedName !== '' && !!tx.merchantId && nameById.get(tx.merchantId) === wantedName;

	return matches
		.sort(
			(a, b) =>
				Number(sameMerchant(b)) - Number(sameMerchant(a)) ||
				Number(b.date === query.date) - Number(a.date === query.date) ||
				b.date.localeCompare(a.date) ||
				b.createdAt - a.createdAt
		)
		.slice(0, options.limit ?? 3);
}
