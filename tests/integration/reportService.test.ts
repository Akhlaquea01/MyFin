import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { NetWorthSnapshotRepository } from '../../src/data/dexie/wealthRepository';
import { generateReportSummary } from '../../src/domain/reports/reportService';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('generateReportSummary against Dexie (via the existing analyticsEngine functions + NetWorthSnapshotRepository)', () => {
	let key: CryptoKey;
	let accountId: string;
	let groceriesId: string;
	let diningId: string;
	let salaryId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('6666', randomSaltBase64());
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
		groceriesId = (await CategoryRepository.create(key, { name: 'Groceries' })).id;
		diningId = (await CategoryRepository.create(key, { name: 'Dining' })).id;
		salaryId = (await CategoryRepository.create(key, { name: 'Salary' })).id;
	});

	it('matches manual computation for a month with income, expense, categories, and net worth snapshots (quickstart Scenario 1)', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-10', amount: 50000, type: 'income' },
			[{ categoryId: salaryId, amount: 50000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-05', amount: -12000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -12000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-06', amount: -8000, type: 'expense' },
			[{ categoryId: diningId, amount: -8000 }]
		);
		await NetWorthSnapshotRepository.create(key, {
			date: '2025-12-20',
			totalAssets: 100000,
			totalLiabilities: 0,
			netWorth: 100000
		});
		await NetWorthSnapshotRepository.create(key, {
			date: '2026-01-25',
			totalAssets: 130000,
			totalLiabilities: 0,
			netWorth: 130000
		});

		const summary = await generateReportSummary(key, { type: 'monthly', year: 2026, month: 1 });

		expect(summary.periodLabel).toBe('January 2026');
		expect(summary.income).toBe(50000);
		expect(summary.expense).toBe(20000);
		expect(summary.netIncome).toBe(30000);
		expect(summary.topCategories.map((c) => c.categoryId)).toEqual([groceriesId, diningId]);
		expect(summary.topCategories[0].total).toBe(12000);
		expect(summary.topCategories[1].total).toBe(8000);
		expect(summary.netWorthStart).toBe(100000);
		expect(summary.netWorthEnd).toBe(130000);
		expect(summary.netWorthDelta).toBe(30000);
		expect(summary.isInProgress).toBe(false);
	});

	it('sums figures across the whole year for a yearly period (quickstart Scenario 2)', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-10', amount: 40000, type: 'income' },
			[{ categoryId: salaryId, amount: 40000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-06-10', amount: 45000, type: 'income' },
			[{ categoryId: salaryId, amount: 45000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-06-15', amount: -10000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -10000 }]
		);

		const summary = await generateReportSummary(key, { type: 'yearly', year: 2026 });

		expect(summary.periodLabel).toBe('2026');
		expect(summary.periodStart).toBe('2026-01-01');
		expect(summary.periodEnd).toBe('2026-12-31');
		expect(summary.income).toBe(85000);
		expect(summary.expense).toBe(10000);
	});

	it('generates a valid, non-erroring report for a period with no data and no applicable net worth history (quickstart Scenario 3)', async () => {
		const summary = await generateReportSummary(key, { type: 'monthly', year: 2020, month: 1 });

		expect(summary.income).toBe(0);
		expect(summary.expense).toBe(0);
		expect(summary.netIncome).toBe(0);
		expect(summary.topCategories).toEqual([]);
		expect(summary.netWorthStart).toBeNull();
		expect(summary.netWorthEnd).toBeNull();
		expect(summary.netWorthDelta).toBeNull();
	});

	it('flags the current, still in-progress month (quickstart Scenario 4, FR-009)', async () => {
		const now = new Date();
		const summary = await generateReportSummary(key, {
			type: 'monthly',
			year: now.getFullYear(),
			month: now.getMonth() + 1
		});

		expect(summary.isInProgress).toBe(true);
	});

	it('does not flag a fully past month as in-progress', async () => {
		const summary = await generateReportSummary(key, { type: 'monthly', year: 2020, month: 1 });
		expect(summary.isInProgress).toBe(false);
	});

	it('lists tied top categories together rather than dropping one (quickstart Scenario 5)', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-04-05', amount: -10000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -10000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-04-06', amount: -10000, type: 'expense' },
			[{ categoryId: diningId, amount: -10000 }]
		);

		const summary = await generateReportSummary(key, { type: 'monthly', year: 2026, month: 4 });

		expect(summary.topCategories).toHaveLength(2);
		expect(summary.topCategories.map((c) => c.categoryId).sort()).toEqual(
			[groceriesId, diningId].sort()
		);
	});
});
