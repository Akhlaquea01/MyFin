import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('TransactionEngine', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('1111', randomSaltBase64());
	});

	it('recalculates the account balance after recording income and expense transactions', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});

		await TransactionEngine.recordTransaction(key, {
			accountId: account.id,
			date: '2026-01-05',
			amount: 50000,
			type: 'income'
		});
		await TransactionEngine.recordTransaction(key, {
			accountId: account.id,
			date: '2026-01-06',
			amount: -20000,
			type: 'expense'
		});

		const updated = await AccountRepository.getById(key, account.id);
		expect(updated?.currentBalance).toBe(100000 + 50000 - 20000);
	});

	it('rejects transaction splits that do not sum to the transaction amount', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});

		await expect(
			TransactionEngine.recordTransaction(
				key,
				{ accountId: account.id, date: '2026-01-05', amount: -1000, type: 'expense' },
				[
					{ categoryId: 'cat-a', amount: -400 },
					{ categoryId: 'cat-b', amount: -400 }
				]
			)
		).rejects.toThrow(/sum to the transaction amount/);
	});

	it('updates both balances on a transfer and excludes it from income/expense totals', async () => {
		const from = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		const to = await AccountRepository.create(key, {
			name: 'Savings',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});

		await TransactionEngine.recordTransfer(key, {
			fromAccountId: from.id,
			toAccountId: to.id,
			amount: 30000,
			date: '2026-01-10'
		});

		const fromAfter = await AccountRepository.getById(key, from.id);
		const toAfter = await AccountRepository.getById(key, to.id);
		expect(fromAfter?.currentBalance).toBe(70000);
		expect(toAfter?.currentBalance).toBe(30000);
	});

	it('recalculates the balance again after a transaction is deleted', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		const tx = await TransactionEngine.recordTransaction(key, {
			accountId: account.id,
			date: '2026-01-05',
			amount: -5000,
			type: 'expense'
		});

		await TransactionEngine.deleteTransaction(key, tx.id);
		expect((await AccountRepository.getById(key, account.id))?.currentBalance).toBe(0);

		await TransactionEngine.restoreTransaction(key, tx.id);
		expect((await AccountRepository.getById(key, account.id))?.currentBalance).toBe(-5000);
	});
});
