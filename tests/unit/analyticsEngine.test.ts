import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { BudgetRepository } from '../../src/data/dexie/budgetRepository';
import { ensureCurrentBudgetItem } from '../../src/domain/budgets/budgetEngine';
import { recordNetWorthSnapshot } from '../../src/domain/wealth/wealthEngine';
import {
	categoryBreakdown,
	incomeExpenseTrend,
	cashFlowTrend,
	budgetPerformance,
	netWorthTrend
} from '../../src/domain/analytics/analyticsEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Analytics engine', () => {
	let key: CryptoKey;
	let accountId: string;
	let groceriesId: string;
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
		const groceries = await CategoryRepository.create(key, { name: 'Groceries' });
		groceriesId = groceries.id;
		const salary = await CategoryRepository.create(key, { name: 'Salary' });
		salaryId = salary.id;
	});

	it('aggregates spending by category, matching manual totals from the ledger', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-05', amount: -3000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -3000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-20', amount: -2000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -2000 }]
		);
		// Income in the same window must not be counted as spending.
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-10', amount: 50000, type: 'income' },
			[{ categoryId: salaryId, amount: 50000 }]
		);

		const breakdown = await categoryBreakdown(key, '2026-01-01', '2026-01-31');
		expect(breakdown).toEqual([
			{ categoryId: groceriesId, categoryName: 'Groceries', total: 5000 }
		]);
	});

	it('builds a monthly income/expense/net-flow trend across multiple months', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-10', amount: 50000, type: 'income' },
			[{ categoryId: salaryId, amount: 50000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-15', amount: -10000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -10000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-02-15', amount: -4000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -4000 }]
		);

		const trend = await incomeExpenseTrend(key, '2026-01-01', '2026-02-28');
		expect(trend).toEqual([
			{ month: '2026-01', income: 50000, expense: 10000, netFlow: 40000 },
			{ month: '2026-02', income: 0, expense: 4000, netFlow: -4000 }
		]);
	});

	it('accumulates cash flow across months into a running total', async () => {
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-01-10', amount: 10000, type: 'income' },
			[{ categoryId: salaryId, amount: 10000 }]
		);
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-02-05', amount: -3000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -3000 }]
		);

		const flow = await cashFlowTrend(key, '2026-01-01', '2026-02-28');
		expect(flow).toEqual([
			{ month: '2026-01', netFlow: 10000, cumulativeFlow: 10000 },
			{ month: '2026-02', netFlow: -3000, cumulativeFlow: 7000 }
		]);
	});

	it('reports planned vs. actual for budgets whose periods overlap the selected range', async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId: groceriesId,
			periodType: 'monthly',
			amount: 10000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-03-05', amount: -3000, type: 'expense' },
			[{ categoryId: groceriesId, amount: -3000 }]
		);
		await ensureCurrentBudgetItem(key, budget, new Date('2026-03-15T00:00:00Z'));

		const performance = await budgetPerformance(key, '2026-03-01', '2026-03-31');
		expect(performance).toEqual([
			{
				budgetId: budget.id,
				categoryId: groceriesId,
				categoryName: 'Groceries',
				periodStart: '2026-03-01',
				periodEnd: '2026-03-31',
				plannedAmount: 10000,
				actualAmount: 3000
			}
		]);
	});

	it('restricts net worth trend to snapshots within the selected date range', async () => {
		await AccountRepository.create(key, {
			name: 'Savings',
			type: 'bank',
			openingBalance: 5000,
			creditLimit: null,
			billingCycleDay: null
		});
		await recordNetWorthSnapshot(key, '2026-01-01');
		await recordNetWorthSnapshot(key, '2026-03-01');

		const trend = await netWorthTrend(key, '2026-02-01', '2026-03-31');
		expect(trend.map((p) => p.date)).toEqual(['2026-03-01']);
	});
});
