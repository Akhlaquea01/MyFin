import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { BudgetRepository } from '../../src/data/dexie/budgetRepository';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { computeVarianceReport } from '../../src/domain/budgets/budgetVarianceEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Budget variance engine', () => {
	let key: CryptoKey;
	let accountId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('1212', randomSaltBase64());
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
	});

	it('classifies a category as over-budget when actual spend exceeds the budget', async () => {
		const category = await CategoryRepository.create(key, { name: 'Groceries' });
		await BudgetRepository.create(key, {
			categoryId: category.id,
			periodType: 'monthly',
			amount: 10000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-06-10', amount: -15000, type: 'expense' },
			[{ categoryId: category.id, amount: -15000 }]
		);

		const results = await computeVarianceReport(key, ['2026-06']);
		const row = results.find((r) => r.categoryId === category.id);
		expect(row?.status).toBe('over');
		expect(row?.budgetedMinor).toBe(10000);
		expect(row?.actualMinor).toBe(15000);
		expect(row?.varianceMinor).toBe(-5000);
	});

	it('classifies a category as under-budget with zero spend, never omitting it', async () => {
		const category = await CategoryRepository.create(key, { name: 'Travel' });
		await BudgetRepository.create(key, {
			categoryId: category.id,
			periodType: 'monthly',
			amount: 20000,
			rolloverEnabled: false,
			isSinkingFund: false
		});

		const results = await computeVarianceReport(key, ['2026-06']);
		const row = results.find((r) => r.categoryId === category.id);
		expect(row).toBeDefined();
		expect(row?.status).toBe('under');
		expect(row?.actualMinor).toBe(0);
		expect(row?.varianceMinor).toBe(20000);
	});

	it('marks a category with spend but no budget as unbudgeted, not zero-variance', async () => {
		const category = await CategoryRepository.create(key, { name: 'Miscellaneous' });
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-06-05', amount: -3000, type: 'expense' },
			[{ categoryId: category.id, amount: -3000 }]
		);

		const results = await computeVarianceReport(key, ['2026-06']);
		const row = results.find((r) => r.categoryId === category.id);
		expect(row?.status).toBe('unbudgeted');
		expect(row?.budgetedMinor).toBeNull();
		expect(row?.actualMinor).toBe(3000);
	});

	it('omits a never-budgeted category with zero spend', async () => {
		const category = await CategoryRepository.create(key, { name: 'Unused' });
		const results = await computeVarianceReport(key, ['2026-06']);
		expect(results.find((r) => r.categoryId === category.id)).toBeUndefined();
	});

	it('reports each requested month separately for a multi-month range', async () => {
		const category = await CategoryRepository.create(key, { name: 'Utilities' });
		await BudgetRepository.create(key, {
			categoryId: category.id,
			periodType: 'monthly',
			amount: 5000,
			rolloverEnabled: false,
			isSinkingFund: false
		});

		const results = await computeVarianceReport(key, ['2026-06', '2026-07']);
		const months = results.filter((r) => r.categoryId === category.id).map((r) => r.month);
		expect(months.sort()).toEqual(['2026-06', '2026-07']);
	});
});
