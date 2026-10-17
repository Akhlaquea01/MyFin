import { db, type AccountRow } from '../dexie/db';
import { decryptRows } from '../dexie/encryptedTable';
import { TransactionRepository, UNCATEGORIZED_CATEGORY_ID } from '../dexie/transactionRepository';
import { TransactionEngine } from '../../domain/transactions/transactionEngine';
import { isValidIsoDate } from '../../domain/shared/dateMath';
import type { Account } from '../../domain/entities';

export type IntegrityIssue =
	| {
			kind: 'balance-mismatch';
			accountId: string;
			accountName: string;
			stored: number;
			expected: number;
	  }
	| { kind: 'split-mismatch'; transactionId: string; amount: number; splitTotal: number }
	| {
			kind: 'broken-transfer';
			transactionId: string;
			reason: 'missing-other-leg' | 'legs-not-paired' | 'amounts-differ';
	  }
	| { kind: 'invalid-date'; transactionId: string; date: string }
	| { kind: 'unknown-account'; transactionId: string; accountId: string }
	| { kind: 'unknown-category'; transactionId: string; categoryId: string };

export interface IntegrityReport {
	checkedTransactions: number;
	issues: IntegrityIssue[];
}

/**
 * Read-only audit of the ledger against the rules everything else relies on: an account's balance
 * is its opening balance plus its entries, an entry's categories add up to its amount, both
 * halves of a transfer exist and cancel out, and every entry points at things that exist. Nothing is
 * written. Balances are derived data and `repairBalances` can rebuild them; everything else is
 * reported for the user to look at, because guessing which side of a broken record is right would
 * risk making it worse.
 */
export async function checkIntegrity(key: CryptoKey): Promise<IntegrityReport> {
	const [transactions, splitsByTx, accountRows, categoryIds] = await Promise.all([
		TransactionRepository.search(key),
		TransactionRepository.splitsByTransaction(key),
		db.accounts.toArray(),
		db.categories.toCollection().primaryKeys()
	]);
	const accounts = await decryptRows<AccountRow, Account>(key, accountRows);
	const accountIds = new Set(accounts.map((account) => account.id));
	const knownCategoryIds = new Set<string>([UNCATEGORIZED_CATEGORY_ID, ...categoryIds.map(String)]);
	const byId = new Map(transactions.map((tx) => [tx.id, tx]));
	const issues: IntegrityIssue[] = [];

	for (const account of accounts) {
		const expected =
			account.openingBalance +
			transactions
				.filter((tx) => tx.accountId === account.id)
				.reduce((sum, tx) => sum + tx.amount, 0);
		if (account.currentBalance !== expected) {
			issues.push({
				kind: 'balance-mismatch',
				accountId: account.id,
				accountName: account.name,
				stored: account.currentBalance,
				expected
			});
		}
	}

	for (const tx of transactions) {
		if (!isValidIsoDate(tx.date)) {
			issues.push({ kind: 'invalid-date', transactionId: tx.id, date: tx.date });
		}
		if (!accountIds.has(tx.accountId)) {
			issues.push({ kind: 'unknown-account', transactionId: tx.id, accountId: tx.accountId });
		}

		const splits = splitsByTx.get(tx.id) ?? [];
		const splitTotal = splits.reduce((sum, split) => sum + split.amount, 0);
		if (splitTotal !== tx.amount) {
			issues.push({ kind: 'split-mismatch', transactionId: tx.id, amount: tx.amount, splitTotal });
		}
		for (const split of splits) {
			if (!knownCategoryIds.has(split.categoryId)) {
				issues.push({
					kind: 'unknown-category',
					transactionId: tx.id,
					categoryId: split.categoryId
				});
			}
		}

		// A person-loan movement is a single-sided 'transfer' with no pair, which is legitimate.
		if (tx.type === 'transfer' && tx.transferPairId) {
			const other = byId.get(tx.transferPairId);
			if (!other) {
				issues.push({ kind: 'broken-transfer', transactionId: tx.id, reason: 'missing-other-leg' });
			} else if (other.transferPairId !== tx.id) {
				issues.push({ kind: 'broken-transfer', transactionId: tx.id, reason: 'legs-not-paired' });
			} else if (other.amount !== -tx.amount) {
				issues.push({ kind: 'broken-transfer', transactionId: tx.id, reason: 'amounts-differ' });
			}
		}
	}

	return { checkedTransactions: transactions.length, issues };
}

/**
 * Rebuilds every account's balance from its ledger. Safe to run at any time: the balance is
 * derived from entries that are left untouched. Returns how many accounts had a wrong balance.
 */
export async function repairBalances(key: CryptoKey): Promise<number> {
	const { issues } = await checkIntegrity(key);
	const wrong = issues.filter((issue) => issue.kind === 'balance-mismatch');
	for (const issue of wrong) {
		await TransactionEngine.recalculateAccountBalance(key, issue.accountId);
	}
	return wrong.length;
}

/** One line a person can read, with enough to find the entry in the ledger. */
export function describeIntegrityIssue(issue: IntegrityIssue): string {
	switch (issue.kind) {
		case 'balance-mismatch':
			return `${issue.accountName}: the stored balance doesn't match its entries.`;
		case 'split-mismatch':
			return `An entry's categories don't add up to its amount (entry ${shortId(issue.transactionId)}).`;
		case 'broken-transfer':
			return `A transfer is inconsistent — ${TRANSFER_REASONS[issue.reason]} (entry ${shortId(issue.transactionId)}).`;
		case 'invalid-date':
			return `An entry has an invalid date "${issue.date}" (entry ${shortId(issue.transactionId)}).`;
		case 'unknown-account':
			return `An entry belongs to an account that no longer exists (entry ${shortId(issue.transactionId)}).`;
		case 'unknown-category':
			return `An entry uses a category that no longer exists (entry ${shortId(issue.transactionId)}).`;
	}
}

const TRANSFER_REASONS: Record<
	Extract<IntegrityIssue, { kind: 'broken-transfer' }>['reason'],
	string
> = {
	'missing-other-leg': 'the other half is missing',
	'legs-not-paired': 'its two halves point at different partners',
	'amounts-differ': 'its two halves have different amounts'
};

function shortId(id: string): string {
	return id.slice(0, 8);
}
