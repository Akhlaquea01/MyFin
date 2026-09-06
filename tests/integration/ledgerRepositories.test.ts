import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Ledger repositories (Account, Category, Transaction) against Dexie', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('3333', randomSaltBase64());
	});

	it('prevents deleting an account that still has active transactions', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		await TransactionRepository.create(
			key,
			{ accountId: account.id, date: '2026-02-01', amount: -1000, type: 'expense' },
			[]
		);

		await expect(AccountRepository.softDelete(key, account.id)).rejects.toThrow(
			/active transactions/
		);
	});

	it('allows deleting an account once its transactions are soft-deleted', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		const tx = await TransactionRepository.create(
			key,
			{ accountId: account.id, date: '2026-02-01', amount: -1000, type: 'expense' },
			[]
		);
		await TransactionRepository.softDelete(key, tx.id);

		await expect(AccountRepository.softDelete(key, account.id)).resolves.not.toThrow();
		const deleted = await AccountRepository.getById(key, account.id);
		expect(deleted?.deletedAt).not.toBeNull();
	});

	it('splits a transaction across multiple categories summing to the total', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		const groceries = await CategoryRepository.create(key, { name: 'Groceries' });
		const household = await CategoryRepository.create(key, { name: 'Household' });

		const tx = await TransactionRepository.create(
			key,
			{ accountId: account.id, date: '2026-02-02', amount: -3000, type: 'expense' },
			[
				{ categoryId: groceries.id, amount: -2000 },
				{ categoryId: household.id, amount: -1000 }
			]
		);

		const splits = await TransactionRepository.getSplits(key, tx.id);
		expect(splits).toHaveLength(2);
		expect(splits.reduce((sum, s) => sum + s.amount, 0)).toBe(-3000);
	});

	it('searches transactions by account, date range, and free text', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		await TransactionRepository.create(
			key,
			{
				accountId: account.id,
				date: '2026-01-01',
				amount: -500,
				type: 'expense',
				notes: 'Coffee shop'
			},
			[]
		);
		await TransactionRepository.create(
			key,
			{
				accountId: account.id,
				date: '2026-06-01',
				amount: -1500,
				type: 'expense',
				notes: 'Groceries run'
			},
			[]
		);

		const byDateRange = await TransactionRepository.search(key, {
			accountId: account.id,
			dateFrom: '2026-05-01',
			dateTo: '2026-12-31'
		});
		expect(byDateRange).toHaveLength(1);
		expect(byDateRange[0].notes).toBe('Groceries run');

		const byText = await TransactionRepository.search(key, { freeText: 'coffee' });
		expect(byText).toHaveLength(1);
		expect(byText[0].notes).toBe('Coffee shop');
	});

	it('excludes soft-deleted transactions from search by default', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		const tx = await TransactionRepository.create(
			key,
			{ accountId: account.id, date: '2026-02-02', amount: -100, type: 'expense' },
			[]
		);
		await TransactionRepository.softDelete(key, tx.id);

		const results = await TransactionRepository.search(key, { accountId: account.id });
		expect(results).toHaveLength(0);

		const withDeleted = await TransactionRepository.search(key, {
			accountId: account.id,
			includeDeleted: true
		});
		expect(withDeleted).toHaveLength(1);
	});
});
