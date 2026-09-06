import { AccountRepository } from '../../data/dexie/accountRepository';
import {
	TransactionRepository,
	type NewTransactionInput,
	type SplitInput
} from '../../data/dexie/transactionRepository';
import { matchTransaction } from '../recurring/recurringEngine';
import type { Transaction } from '../../domain/entities';

/**
 * Recomputes an account's `currentBalance` from scratch: opening balance plus the sum of
 * every non-deleted transaction on it. Simple and always correct — the safest choice for
 * a personal ledger where trust in the numbers matters more than micro-optimizing away an
 * O(n) recalculation on every edit. Revisit only if profiling ever shows this is a real
 * bottleneck (no Success Criteria requires fast writes, only fast search — SC-008).
 */
async function recalculateAccountBalance(key: CryptoKey, accountId: string): Promise<void> {
	const account = await AccountRepository.getById(key, accountId);
	if (!account) return;
	const transactions = await TransactionRepository.search(key, { accountId });
	const total = transactions.reduce((sum, tx) => sum + tx.amount, 0);
	await AccountRepository.setBalance(key, accountId, account.openingBalance + total);
}

export const TransactionEngine = {
	async recordTransaction(
		key: CryptoKey,
		input: NewTransactionInput,
		splits: SplitInput[] = []
	): Promise<Transaction> {
		const tx = await TransactionRepository.create(key, input, splits);
		await recalculateAccountBalance(key, tx.accountId);

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
	}
};
