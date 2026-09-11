import { AccountRepository } from '../../data/dexie/accountRepository';
import {
	TransactionRepository,
	type NewTransactionInput,
	type SplitInput
} from '../../data/dexie/transactionRepository';
import { TransactionTagRepository } from '../../data/dexie/tagRepository';
import { matchTransaction } from '../recurring/recurringEngine';
import { resolveCategorization, recordConfirmation } from '../categorization/resolveCategorization';
import type { Transaction } from '../../domain/entities';

/**
 * Recomputes an account's `currentBalance` from scratch: opening balance plus the sum of
 * every non-deleted transaction on it. Simple and always correct — the safest choice for
 * a personal ledger where trust in the numbers matters more than micro-optimizing away an
 * O(n) recalculation on every edit. Revisit only if profiling ever shows this is a real
 * bottleneck (no Success Criteria requires fast writes, only fast search — SC-008).
 */
export async function recalculateAccountBalance(key: CryptoKey, accountId: string): Promise<void> {
	const account = await AccountRepository.getById(key, accountId);
	if (!account) return;
	const transactions = await TransactionRepository.search(key, { accountId });
	const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
	await AccountRepository.setBalance(key, accountId, account.openingBalance + total);
}

/** Options shared by the write paths that can defer balance maintenance. */
export interface RecordOptions {
	/**
	 * Skip the per-write balance recalculation. Set by bulk callers (file/text import) that
	 * recalculate once at the end instead: the recalculation is O(account size), so running it
	 * per row made importing N rows cost ~N^2/2 decryptions. The caller becomes responsible for
	 * calling `recalculateAccountBalance` before the user sees a balance.
	 */
	deferBalance?: boolean;
}

export const TransactionEngine = {
	recalculateAccountBalance,

	async recordTransaction(
		key: CryptoKey,
		input: NewTransactionInput,
		splits: SplitInput[] = [],
		options: RecordOptions = {}
	): Promise<Transaction> {
		// Auto-categorization pre-fill (spec 006, FR-002): only when the caller hasn't
		// already specified a category — today that's every source but Quick Add/bulk/file
		// import, which never pass splits of their own.
		let resolvedSplits = splits;
		let categorizationTagIds: string[] = [];
		if (splits.length === 0 && input.merchantId) {
			const result = await resolveCategorization(
				key,
				input.merchantId,
				input.merchantAliasId ?? null
			);
			if (result) {
				resolvedSplits = [
					{
						categoryId: result.categoryId,
						amount: input.amount,
						categorizationSource: result.source
					}
				];
				categorizationTagIds = result.tagIds;
			}
		}

		const tx = await TransactionRepository.create(key, input, resolvedSplits);
		if (categorizationTagIds.length > 0) {
			await TransactionTagRepository.setTags(tx.id, categorizationTagIds);
		}
		if (!options.deferBalance) await recalculateAccountBalance(key, tx.accountId);

		// Best-effort recurring-event matching (FR-030): try each split's category until
		// one matches a pending expected event. Never blocks/fails the transaction itself.
		const txSplits = await TransactionRepository.getSplits(key, tx.id);
		for (const split of txSplits) {
			const matched = await matchTransaction(key, tx, split.categoryId);
			if (matched) break;
		}

		return tx;
	},

	async recordTransfer(
		key: CryptoKey,
		params: {
			fromAccountId: string;
			toAccountId: string;
			amount: number;
			date: string;
			notes?: string;
		}
	): Promise<[Transaction, Transaction]> {
		if (params.fromAccountId === params.toAccountId) {
			throw new Error('A transfer must be between two different accounts.');
		}
		if (params.amount <= 0) {
			throw new Error('Transfer amount must be positive.');
		}
		const pair = await TransactionRepository.createTransferPair(key, params);
		await recalculateAccountBalance(key, params.fromAccountId);
		await recalculateAccountBalance(key, params.toAccountId);
		return pair;
	},

	async editTransaction(
		key: CryptoKey,
		id: string,
		changes: Partial<Transaction>,
		splits?: SplitInput[]
	): Promise<Transaction> {
		const before = await TransactionRepository.getById(key, id);
		const updated = await TransactionRepository.update(key, id, changes, splits);
		await recalculateAccountBalance(key, updated.accountId);
		if (before && before.accountId !== updated.accountId) {
			await recalculateAccountBalance(key, before.accountId);
		}
		return updated;
	},

	async deleteTransaction(key: CryptoKey, id: string): Promise<void> {
		const tx = await TransactionRepository.getById(key, id);
		await TransactionRepository.softDelete(key, id);
		if (tx) await recalculateAccountBalance(key, tx.accountId);
	},

	async restoreTransaction(key: CryptoKey, id: string): Promise<void> {
		await TransactionRepository.restore(key, id);
		const tx = await TransactionRepository.getById(key, id);
		if (tx) await recalculateAccountBalance(key, tx.accountId);
	},

	/**
	 * Confirms a Review Queue transaction (spec 006), optionally applying a user's edited
	 * category/tags before it leaves `unreviewed` — the only entry point that carries a
	 * pre-filled category from `recordTransaction` through to a permanent, confirmed choice.
	 */
	async confirmTransaction(
		key: CryptoKey,
		id: string,
		splits?: SplitInput[],
		tagIds?: string[]
	): Promise<Transaction> {
		const updated = await TransactionRepository.update(
			key,
			id,
			{ reviewStatus: 'confirmed' },
			splits
		);
		if (tagIds) {
			await TransactionTagRepository.setTags(id, tagIds);
		}

		// Learning signal (spec 006, FR-003/FR-007): only the three auto-entry sources ever
		// reach `unreviewed`/this confirm path, so this naturally scopes learning to exactly
		// "confirmed during review" without needing to branch on `source` explicitly.
		if (updated.merchantId) {
			const [firstSplit] = await TransactionRepository.getSplits(key, id);
			if (firstSplit) {
				await recordConfirmation(key, updated.merchantId, firstSplit.categoryId);
			}
		}

		return updated;
	}
};
