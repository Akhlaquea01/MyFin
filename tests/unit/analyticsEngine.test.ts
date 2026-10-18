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
	foldSmallCategories,
	withLiveBudgetActuals,
	netWorthTrend,
	OTHER_CATEGORY_ID,
	type CategoryBreakdownItem
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

	describe('income/expense with refunds', () => {
		const record = (date: string, amount: number, categoryId: string) =>
			TransactionRepository.create(
				key,
				{ accountId, date, amount, type: amount < 0 ? 'expense' : 'income' },
				[{ categoryId, amount }]
			);

		beforeEach(async () => {
			await record('2026-01-05', -5000, groceriesId);
			await record('2026-01-06', 2000, groceriesId); // a refund
			await record('2026-01-07', 50000, salaryId);
		});

		it('reads money out and in as they happened by default', async () => {
			const [jan] = await incomeExpenseTrend(key, '2026-01-01', '2026-01-31');
			expect(jan).toMatchObject({ income: 52000, expense: 5000, netFlow: 47000 });
		});

		it('with netRefunds, money back into a spending category comes off money out instead', async () => {
			const [jan] = await incomeExpenseTrend(key, '2026-01-01', '2026-01-31', { netRefunds: true });
			expect(jan).toMatchObject({ income: 50000, expense: 3000, netFlow: 47000 });
		});

		it('with netRefunds, money out equals what the category breakdown adds up to', async () => {
			const [jan] = await incomeExpenseTrend(key, '2026-01-01', '2026-01-31', { netRefunds: true });
			const breakdown = await categoryBreakdown(key, '2026-01-01', '2026-01-31');
			expect(jan.expense).toBe(breakdown.reduce((sum, item) => sum + item.total, 0));
		});
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

	it('recomputes actual spend from the ledger when the stored figure has gone stale', async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId: groceriesId,
			periodType: 'monthly',
			amount: 10000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		await ensureCurrentBudgetItem(key, budget, new Date('2026-03-15T00:00:00Z'));
		// Spent after the budget item was last opened, so nothing has refreshed the stored figure.
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-03-20', amount: -4500, type: 'expense' },
			[{ categoryId: groceriesId, amount: -4500 }]
		);

		const stored = await budgetPerformance(key, '2026-03-01', '2026-03-31');
		expect(stored[0].actualAmount).toBe(0);

		const live = await withLiveBudgetActuals(key, stored);
		expect(live).toHaveLength(1);
		expect(live[0].actualAmount).toBe(4500);
		expect(live[0].plannedAmount).toBe(10000);
		expect(stored[0].actualAmount).toBe(0);
	});

	it('leaves an empty list alone', async () => {
		expect(await withLiveBudgetActuals(key, [])).toEqual([]);
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

describe('foldSmallCategories', () => {
	const categories = (count: number): CategoryBreakdownItem[] =>
		Array.from({ length: count }, (_, i) => ({
			categoryId: `c${i}`,
			categoryName: `Category ${i}`,
			total: (count - i) * 100
		}));

	it('leaves a short list as it is', () => {
		const list = categories(10);
		expect(foldSmallCategories(list, 10)).toBe(list);
	});

	it('adds everything past the limit into one "Other" bar, keeping the total', () => {
		const list = categories(15);
		const folded = foldSmallCategories(list, 10);
		expect(folded).toHaveLength(11);
		expect(folded.slice(0, 10)).toEqual(list.slice(0, 10));
		const other = folded[10];
		expect(other.categoryId).toBe(OTHER_CATEGORY_ID);
		expect(other.categoryName).toBe('Other (5 categories)');
		expect(folded.reduce((sum, c) => sum + c.total, 0)).toBe(
			list.reduce((sum, c) => sum + c.total, 0)
		);
	});

	it('does not fold a lone category into "Other", which would only rename it', () => {
		const list = categories(11);
		expect(foldSmallCategories(list, 10)).toBe(list);
	});
});
