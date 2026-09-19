import { formatTransactionLabel } from '../transactions/transactionLabel';
import { formatMinorUnits } from '../shared/money';
import type { Transaction, Merchant, Account } from '../entities';

export type SearchIndexEntryType = 'transaction' | 'payee' | 'account';

export interface SearchIndexEntry {
	type: SearchIndexEntryType;
	id: string;
	label: string;
	secondaryLabel?: string;
	route: string;
	/** Recency tiebreak — higher sorts first among equally-good matches. */
	sortKey: number;
}

const DEFAULT_LIMIT = 20;

/**
 * Builds the in-memory search index the command palette queries (FR-018–FR-020,
 * contracts/command-palette-search.md). Pure — takes already-decrypted data the caller loaded
 * via existing repositories; never touches Dexie itself. Meant to be built once per unlock and
 * discarded on lock (see AppShell.tsx), since Dexie's blind-index columns are exact-match only
 * and can't support the substring queries this palette needs.
 */
export function buildSearchIndex(
	transactions: Transaction[],
	merchants: Merchant[],
	accounts: Account[]
): SearchIndexEntry[] {
	const entries: SearchIndexEntry[] = [];

	for (const tx of transactions) {
		if (tx.deletedAt) continue;
		entries.push({
			type: 'transaction',
			id: tx.id,
			label: formatTransactionLabel(tx, merchants),
			secondaryLabel: `${formatMinorUnits(tx.amount)} · ${tx.date}`,
			route: '/transactions',
			sortKey: Date.parse(tx.date) || 0
		});
	}

	for (const merchant of merchants) {
		if (merchant.deletedAt) continue;
		entries.push({
			type: 'payee',
			id: merchant.id,
			label: merchant.name,
			route: '/transactions',
			sortKey: merchant.updatedAt
		});
	}

	for (const account of accounts) {
		if (account.deletedAt) continue;
		entries.push({
			type: 'account',
			id: account.id,
			label: account.name,
			secondaryLabel: formatMinorUnits(account.currentBalance),
			route: '/accounts',
			sortKey: account.updatedAt
		});
	}

	return entries;
}

function normalize(text: string): string {
	return text.trim().toLowerCase();
}

/**
 * Case-insensitive substring + token-prefix match over `label`/`secondaryLabel`, ranked by
 * match quality (an exact/prefix match on `label` first) then `sortKey` (recency) as tiebreak,
 * always capped at `limit` (spec Edge Cases: never an unbounded result list).
 */
export function querySearchIndex(
	index: SearchIndexEntry[],
	query: string,
	limit: number = DEFAULT_LIMIT
): SearchIndexEntry[] {
	const needle = normalize(query);
	if (!needle) return [];

	const scored: { entry: SearchIndexEntry; score: number }[] = [];
	for (const entry of index) {
		const label = normalize(entry.label);
		const secondary = entry.secondaryLabel ? normalize(entry.secondaryLabel) : '';
		let score = -1;
		if (label === needle) score = 3;
		else if (label.startsWith(needle)) score = 2;
		else if (label.includes(needle) || secondary.includes(needle)) score = 1;
		if (score >= 0) scored.push({ entry, score });
	}

	scored.sort((a, b) => b.score - a.score || b.entry.sortKey - a.entry.sortKey);
	return scored.slice(0, limit).map((s) => s.entry);
}
