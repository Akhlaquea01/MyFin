import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../src/data/dexie/transactionRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { categoryBreakdown, incomeExpenseTrend } from '../../src/domain/analytics/analyticsEngine';
import { getDashboardInsights } from '../../src/domain/analytics/dashboardInsights';
import { checkIntegrity } from '../../src/data/io/integrityService';
import { buildDataTemplate, importDataTemplate } from '../../src/data/io/templateService';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

// "Adjust balance" brings an account to the figure its owner says it really holds. That is a
// correction, not money earned or spent, so it must move the balance and nothing else.
describe('balance adjustment', () => {
	let key: CryptoKey;
	let accountId: string;
	let foodId: string;

	async function freshInstall(pin: string): Promise<CryptoKey> {
		await db.delete();
		await db.open();
		const salt = randomSaltBase64();
		const k = await deriveEncryptionKey(pin, salt);
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin(pin, pinSalt),
			pinSalt,
			encryptionSalt: salt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
		return k;
	}

	const balance = async (id = accountId) =>
		(await AccountRepository.getById(key, id))!.currentBalance;

	beforeEach(async () => {
		key = await freshInstall('2121');
		accountId = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 100_000,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
		foodId = (await CategoryRepository.create(key, { name: 'Food' })).id;
		await TransactionEngine.recordTransaction(key, {
			accountId,
			date: '2026-10-02',
			amount: 50_000,
			type: 'income'
		});
		await TransactionEngine.recordTransaction(
			key,
			{ accountId, date: '2026-10-03', amount: -10_000, type: 'expense' },
			[{ categoryId: foodId, amount: -10_000 }]
		);
	});

	it('moves the balance, but is neither income nor spending anywhere', async () => {
		await TransactionEngine.recordBalanceAdjustment(key, {
			accountId,
			amount: 7_000,
			date: '2026-10-05'
		});
		await TransactionEngine.recordBalanceAdjustment(key, {
			accountId,
			amount: -3_000,
			date: '2026-10-06'
		});

		expect(await balance()).toBe(100_000 + 50_000 - 10_000 + 7_000 - 3_000);

		// Money in and out, by month and by category, are what they were before the corrections.
		expect(await incomeExpenseTrend(key, '2026-10-01', '2026-10-31')).toEqual([
			{ month: '2026-10', income: 50_000, expense: 10_000, netFlow: 40_000 }
		]);
		expect(await categoryBreakdown(key, '2026-10-01', '2026-10-31')).toEqual([
			{ categoryId: foodId, categoryName: 'Food', total: 10_000 }
		]);
		const insights = await getDashboardInsights(key, '2026-10-15');
		expect(insights.income).toBe(50_000);
		expect(insights.expense).toBe(10_000);
		expect(insights.spendingTotal).toBe(10_000);

		// And the ledger still adds up.
		expect((await checkIntegrity(key)).issues).toEqual([]);
	});

	it('is a one-sided movement marked as an adjustment, in the direction of the difference', async () => {
		const up = await TransactionEngine.recordBalanceAdjustment(key, {
			accountId,
			amount: 7_000,
			date: '2026-10-05'
		});
		const down = await TransactionEngine.recordBalanceAdjustment(key, {
			accountId,
			amount: -3_000,
			date: '2026-10-06'
		});

		expect(up).toMatchObject({
			type: 'transfer',
			transferPairId: null,
			source: 'balance_adjustment',
			amount: 7_000
		});
		expect(down).toMatchObject({ type: 'transfer', amount: -3_000 });
		expect(await TransactionRepository.getSplits(key, up.id)).toMatchObject([
			{ categoryId: UNCATEGORIZED_CATEGORY_ID, amount: 7_000 }
		]);
	});

	it('refuses an adjustment of nothing', async () => {
		await expect(
			TransactionEngine.recordBalanceAdjustment(key, { accountId, amount: 0, date: '2026-10-05' })
		).rejects.toThrow(/no difference/i);
	});

	it('stays an adjustment when its size or date is corrected', async () => {
		const adjustment = await TransactionEngine.recordBalanceAdjustment(key, {
			accountId,
			amount: 7_000,
			date: '2026-10-05'
		});

		const edited = await TransactionEngine.editTransaction(
			key,
			adjustment.id,
			{ date: '2026-10-07', amount: 9_000, notes: 'Cash counted again' },
			[{ categoryId: UNCATEGORIZED_CATEGORY_ID, amount: 9_000 }]
		);

		expect(edited).toMatchObject({
			type: 'transfer',
			source: 'balance_adjustment',
			amount: 9_000,
			date: '2026-10-07'
		});
		expect(await balance()).toBe(100_000 + 50_000 - 10_000 + 9_000);
		const trend = await incomeExpenseTrend(key, '2026-10-01', '2026-10-31');
		expect(trend[0]).toMatchObject({ income: 50_000, expense: 10_000 });
	});

	it('takes the balance back when it is deleted', async () => {
		const adjustment = await TransactionEngine.recordBalanceAdjustment(key, {
			accountId,
			amount: 7_000,
			date: '2026-10-05'
		});
		await TransactionEngine.deleteTransaction(key, adjustment.id);

		expect(await balance()).toBe(100_000 + 50_000 - 10_000);
	});

	it('comes back from a data template as an adjustment, not as income or a loan', async () => {
		await TransactionEngine.recordBalanceAdjustment(key, {
			accountId,
			amount: 7_000,
			date: '2026-10-05'
		});
		const template = await buildDataTemplate(key);

		const imported = await freshInstall('3131');
		await importDataTemplate(imported, template);

		const all = await TransactionRepository.search(imported, {});
		const restored = all.find((t) => t.notes === 'Balance adjustment');
		expect(restored).toMatchObject({
			type: 'transfer',
			transferPairId: null,
			source: 'balance_adjustment',
			amount: 7_000
		});
		const [account] = await AccountRepository.list(imported);
		expect(account.currentBalance).toBe(100_000 + 50_000 - 10_000 + 7_000);
	});
});
