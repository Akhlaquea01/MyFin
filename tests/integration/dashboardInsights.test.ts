import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { BudgetRepository, BudgetItemRepository } from '../../src/data/dexie/budgetRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { getDashboardInsights } from '../../src/domain/analytics/dashboardInsights';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

const TODAY = '2026-10-15';

describe('getDashboardInsights', () => {
	let key: CryptoKey;
	let account: string;
	const cats: Record<string, string> = {};

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('4141', randomSaltBase64());
		account = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
		for (const name of ['Food', 'Travel', 'Fun', 'Rent', 'Bills', 'Gifts', 'Health']) {
			cats[name] = (await CategoryRepository.create(key, { name })).id;
		}
	});

	const record = (date: string, amount: number, category: string | null = null) =>
		TransactionEngine.recordTransaction(
			key,
			{ accountId: account, date, amount, type: amount < 0 ? 'expense' : 'income' },
			category ? [{ categoryId: cats[category], amount }] : []
		);

	it('reads this month, six months of in/out with the empty months present, and the top spending', async () => {
		await record('2026-10-02', 500_000);
		await record('2026-10-03', -30_000, 'Food');
		await record('2026-10-04', -10_000, 'Travel');
		await record('2026-08-10', 400_000);
		await record('2026-08-11', -90_000, 'Rent');
		await record('2026-03-01', -77_000, 'Food'); // outside the six months

		const insights = await getDashboardInsights(key, TODAY);

		expect(insights.month).toBe('2026-10');
		expect(insights.income).toBe(500_000);
		expect(insights.expense).toBe(40_000);
		expect(insights.trend.map((p) => p.month)).toEqual([
			'2026-05',
			'2026-06',
			'2026-07',
			'2026-08',
			'2026-09',
			'2026-10'
		]);
		expect(insights.trend.find((p) => p.month === '2026-09')).toMatchObject({
			income: 0,
			expense: 0
		});
		expect(insights.trend.find((p) => p.month === '2026-08')).toMatchObject({
			income: 400_000,
			expense: 90_000
		});
		// Spending is this month's only, biggest first.
		expect(insights.spending.map((s) => [s.label, s.total])).toEqual([
			['Food', 30_000],
			['Travel', 10_000]
		]);
		expect(insights.spendingTotal).toBe(40_000);
	});

	it('takes money that came back into a category off money out, so it matches "Where it went"', async () => {
		await record('2026-10-02', 500_000); // salary
		await record('2026-10-03', -90_000, 'Food');
		await record('2026-10-04', 40_000, 'Food'); // a friend pays back
		await record('2026-10-05', -10_000, 'Travel');
		await record('2026-08-11', -50_000, 'Rent');
		await record('2026-08-12', 20_000, 'Rent'); // a deposit refund, in an earlier month

		const insights = await getDashboardInsights(key, TODAY);

		expect(insights.spendingTotal).toBe(60_000);
		expect(insights.expense).toBe(insights.spendingTotal);
		expect(insights.income).toBe(500_000);
		// Net flow is what it always was: 540,000 in, 100,000 out.
		expect(insights.income - insights.expense).toBe(440_000);
		expect(insights.trend.find((p) => p.month === '2026-08')).toMatchObject({
			income: 0,
			expense: 30_000
		});
	});

	it('nets a refund in one subcategory against spending in its sibling, as the roll-up does', async () => {
		cats.Groceries = (
			await CategoryRepository.create(key, { name: 'Groceries', parentId: cats.Food })
		).id;
		cats.Dining = (
			await CategoryRepository.create(key, { name: 'Dining', parentId: cats.Food })
		).id;
		await record('2026-10-03', -30_000, 'Groceries');
		await record('2026-10-04', 10_000, 'Dining');

		const insights = await getDashboardInsights(key, TODAY);

		expect(insights.spendingTotal).toBe(20_000);
		expect(insights.expense).toBe(20_000);
		expect(insights.income).toBe(0);
	});

	it('keeps unlabelled money in as income, so a salary never hides spending', async () => {
		await record('2026-10-01', 100_000);
		await record('2026-10-02', -30_000);

		const insights = await getDashboardInsights(key, TODAY);

		expect(insights.income).toBe(100_000);
		expect(insights.expense).toBe(30_000);
		expect(insights.spendingTotal).toBe(30_000);
	});

	it('folds spending past the top five into one "Other" that still adds up', async () => {
		const names = ['Food', 'Travel', 'Fun', 'Rent', 'Bills', 'Gifts', 'Health'];
		for (const [i, name] of names.entries())
			await record('2026-10-05', -(70_000 - i * 5_000), name);
		const insights = await getDashboardInsights(key, TODAY);

		expect(insights.spending).toHaveLength(6);
		expect(insights.spending[5]).toMatchObject({ label: 'Other', total: 45_000 + 40_000 });
		expect(insights.spending.reduce((n, s) => n + s.total, 0)).toBe(insights.spendingTotal);
	});

	it('does not count a transfer as spending or income', async () => {
		const other = (
			await AccountRepository.create(key, {
				name: 'Savings',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
		await TransactionEngine.recordTransfer(key, {
			fromAccountId: account,
			toAccountId: other,
			amount: 100_000,
			date: '2026-10-06'
		});
		const insights = await getDashboardInsights(key, TODAY);
		expect(insights.income).toBe(0);
		expect(insights.expense).toBe(0);
		expect(insights.spending).toEqual([]);
	});

	it('lists the budgets closest to their limit first, at most three', async () => {
		const make = async (name: string, planned: number, actual: number) => {
			const budget = await BudgetRepository.create(key, {
				categoryId: cats[name],
				periodType: 'monthly',
				amount: planned,
				rolloverEnabled: false,
				isSinkingFund: false
			});
			await BudgetItemRepository.create(key, {
				budgetId: budget.id,
				periodStart: '2026-10-01',
				periodEnd: '2026-10-31',
				plannedAmount: planned,
				// The saved figure is left stale on purpose: the spend that counts is the ledger's.
				actualAmount: 0,
				rolloverInAmount: 0
			});
			await record('2026-10-05', -actual, name);
		};
		await make('Food', 100_000, 40_000);
		await make('Travel', 100_000, 120_000);
		await make('Fun', 100_000, 90_000);
		await make('Rent', 100_000, 10_000);

		const insights = await getDashboardInsights(key, TODAY);
		expect(insights.budgets.map((b) => b.label)).toEqual(['Travel', 'Fun', 'Food']);
	});

	it("reads a budget's spend from the ledger, not the figure saved when it was last opened", async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId: cats.Food,
			periodType: 'monthly',
			amount: 100_000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		await BudgetItemRepository.create(key, {
			budgetId: budget.id,
			periodStart: '2026-10-01',
			periodEnd: '2026-10-31',
			plannedAmount: 100_000,
			actualAmount: 0,
			rolloverInAmount: 0
		});
		await record('2026-10-04', -120_000, 'Food'); // recorded after the budget was last opened

		const insights = await getDashboardInsights(key, TODAY);

		expect(insights.budgets).toMatchObject([{ label: 'Food', planned: 100_000, actual: 120_000 }]);
	});

	it('is empty and safe for a ledger with nothing in it', async () => {
		const insights = await getDashboardInsights(key, TODAY);
		expect(insights).toMatchObject({ income: 0, expense: 0, spending: [], budgets: [] });
		expect(insights.trend).toHaveLength(6);
	});
});
