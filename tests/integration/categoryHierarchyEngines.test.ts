import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { BudgetRepository } from '../../src/data/dexie/budgetRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import {
	ensureBudgetItemForPeriod,
	recalcActualAmount
} from '../../src/domain/budgets/budgetEngine';
import { computeVarianceReport } from '../../src/domain/budgets/budgetVarianceEngine';
import { budgetPerformance, categoryBreakdown } from '../../src/domain/analytics/analyticsEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// Categories are a tree. A budget on "Food" is a budget for food — groceries and dining out
// included — and a chart must be able to tell "Food › Other" from "Travel › Other".
describe('category hierarchy in budgets and analytics', () => {
	let key: CryptoKey;
	let accountId: string;
	let food: string;
	let groceries: string;
	let fruit: string;
	let dining: string;
	let travel: string;
	let foodOther: string;
	let travelOther: string;

	const MARCH = new Date('2026-03-15T00:00:00Z');
	const PERIOD: [string, string] = ['2026-03-01', '2026-03-31'];

	async function spend(categoryId: string, amount: number, date = '2026-03-05') {
		await TransactionRepository.create(key, { accountId, date, amount: -amount, type: 'expense' }, [
			{ categoryId, amount: -amount }
		]);
	}
	const budgetOn = (categoryId: string, amount = 100_000) =>
		BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount,
			rolloverEnabled: false,
			isSinkingFund: false
		});

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('5252', randomSaltBase64());
		accountId = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
		const mk = async (name: string, parentId: string | null = null) =>
			(await CategoryRepository.create(key, { name, parentId })).id;
		food = await mk('Food');
		groceries = await mk('Groceries', food);
		fruit = await mk('Fruit', groceries);
		dining = await mk('Dining out', food);
		foodOther = await mk('Other', food);
		travel = await mk('Travel');
		travelOther = await mk('Other', travel);
	});

	describe('budget actuals', () => {
		it('a budget on a parent counts spending in its subcategories, at any depth', async () => {
			await spend(food, 1_000);
			await spend(groceries, 2_000);
			await spend(fruit, 4_000); // grandchild
			await spend(dining, 8_000);
			await spend(travel, 99_000); // a different branch: never counted

			expect(await recalcActualAmount(key, food, ...PERIOD)).toBe(15_000);
			expect(await recalcActualAmount(key, groceries, ...PERIOD)).toBe(6_000);
			expect(await recalcActualAmount(key, fruit, ...PERIOD)).toBe(4_000);
		});

		it('can be asked for the category on its own', async () => {
			await spend(food, 1_000);
			await spend(groceries, 2_000);
			expect(await recalcActualAmount(key, food, ...PERIOD, { includeSubcategories: false })).toBe(
				1_000
			);
		});

		it('is unchanged for a category with no subcategories', async () => {
			await spend(travel, 3_000);
			await spend(travelOther, 500);
			expect(await recalcActualAmount(key, travelOther, ...PERIOD)).toBe(500);
		});

		it('nets income in a subcategory against the parent budget, never below zero', async () => {
			await spend(food, 1_000);
			await TransactionRepository.create(
				key,
				{ accountId, date: '2026-03-06', amount: 5_000, type: 'income' },
				[{ categoryId: groceries, amount: 5_000 }]
			);
			expect(await recalcActualAmount(key, food, ...PERIOD)).toBe(0);
		});

		it('only counts the period asked about', async () => {
			await spend(groceries, 2_000);
			await spend(groceries, 7_000, '2026-04-02');
			expect(await recalcActualAmount(key, food, ...PERIOD)).toBe(2_000);
		});

		it('flows into the budget item, and refreshes an item that was created before the spend', async () => {
			const budget = await budgetOn(food);
			const created = await ensureBudgetItemForPeriod(key, budget, MARCH);
			expect(created.actualAmount).toBe(0);

			await spend(groceries, 12_000);
			const refreshed = await ensureBudgetItemForPeriod(key, budget, MARCH);
			expect(refreshed.id).toBe(created.id);
			expect(refreshed.actualAmount).toBe(12_000);
		});

		it('a child budget tracks only the child; the parent budget includes it as well', async () => {
			const parent = await budgetOn(food);
			const child = await budgetOn(groceries);
			await spend(groceries, 5_000);
			await spend(dining, 1_000);

			expect((await ensureBudgetItemForPeriod(key, parent, MARCH)).actualAmount).toBe(6_000);
			expect((await ensureBudgetItemForPeriod(key, child, MARCH)).actualAmount).toBe(5_000);
		});
	});

	describe('budget variance report', () => {
		const rowsFor = async () => {
			const rows = await computeVarianceReport(key, ['2026-03']);
			return new Map(rows.map((r) => [r.categoryId, r]));
		};

		it('a budgeted parent includes its children, and the children are not reported as unbudgeted', async () => {
			await budgetOn(food, 100_000);
			await spend(groceries, 30_000);
			await spend(dining, 20_000);

			const rows = await rowsFor();
			expect(rows.get(food)).toMatchObject({ actualMinor: 50_000, status: 'under' });
			// Their money is already inside the Food row — listing it again as "unbudgeted" would
			// contradict that and show the same spend twice.
			expect(rows.has(groceries)).toBe(false);
			expect(rows.has(dining)).toBe(false);
		});

		it('an unbudgeted parent reports only what is filed directly under it; its children get their own rows', async () => {
			await spend(food, 1_000);
			await spend(groceries, 2_000);

			const rows = await rowsFor();
			expect(rows.get(food)).toMatchObject({ actualMinor: 1_000, status: 'unbudgeted' });
			expect(rows.get(groceries)).toMatchObject({ actualMinor: 2_000, status: 'unbudgeted' });
		});

		it('a budgeted child under an unbudgeted parent keeps its own budget row', async () => {
			await budgetOn(groceries, 10_000);
			await spend(groceries, 12_000);
			await spend(food, 500);

			const rows = await rowsFor();
			expect(rows.get(groceries)).toMatchObject({ actualMinor: 12_000, status: 'over' });
			expect(rows.get(food)).toMatchObject({ actualMinor: 500, status: 'unbudgeted' });
		});

		it('an unrelated unbudgeted category is still reported', async () => {
			await budgetOn(food);
			await spend(travel, 4_000);
			const rows = await rowsFor();
			expect(rows.get(travel)).toMatchObject({ actualMinor: 4_000, status: 'unbudgeted' });
		});

		it('the total of all rows never counts a subcategory twice when only the parent is budgeted', async () => {
			await budgetOn(food, 100_000);
			await spend(food, 1_000);
			await spend(groceries, 2_000);
			await spend(fruit, 4_000);
			const total = [...(await rowsFor()).values()].reduce((sum, r) => sum + r.actualMinor, 0);
			expect(total).toBe(7_000);
		});
	});

	describe('analytics', () => {
		it('labels subcategories with their path so equally named ones can be told apart', async () => {
			await spend(foodOther, 3_000);
			await spend(travelOther, 2_000);
			await spend(travel, 1_000);

			const breakdown = await categoryBreakdown(key, ...PERIOD);
			expect(breakdown.map((b) => b.categoryName)).toEqual([
				'Food › Other',
				'Travel › Other',
				'Travel'
			]);
		});

		it('can group each subcategory under its top-level parent', async () => {
			await spend(food, 1_000);
			await spend(groceries, 2_000);
			await spend(fruit, 4_000);
			await spend(foodOther, 8_000);
			await spend(travelOther, 500);

			const rolled = await categoryBreakdown(key, ...PERIOD, { rollUp: true });
			expect(rolled).toEqual([
				{ categoryId: food, categoryName: 'Food', total: 15_000 },
				{ categoryId: travel, categoryName: 'Travel', total: 500 }
			]);
			// The grand total is the same either way.
			const flat = await categoryBreakdown(key, ...PERIOD);
			expect(flat.reduce((s, b) => s + b.total, 0)).toBe(rolled.reduce((s, b) => s + b.total, 0));
		});

		it('still leaves a transfer out of spending, rolled up or not', async () => {
			await spend(groceries, 2_000);
			await TransactionRepository.create(
				key,
				{ accountId, date: '2026-03-05', amount: -9_000, type: 'transfer', transferPairId: 'x' },
				[]
			);
			for (const rollUp of [false, true]) {
				const result = await categoryBreakdown(key, ...PERIOD, { rollUp });
				expect(result.reduce((s, b) => s + b.total, 0)).toBe(2_000);
			}
		});

		it('names a budget by its path in budget performance', async () => {
			const budget = await budgetOn(foodOther);
			await ensureBudgetItemForPeriod(key, budget, MARCH);
			const [row] = await budgetPerformance(key, ...PERIOD);
			expect(row.categoryName).toBe('Food › Other');
		});

		it('a deleted subcategory is reported as Uncategorized, as before', async () => {
			await spend(groceries, 2_000);
			await CategoryRepository.softDelete(key, groceries);
			const breakdown = await categoryBreakdown(key, ...PERIOD);
			expect(breakdown).toEqual([
				{ categoryId: groceries, categoryName: 'Uncategorized', total: 2_000 }
			]);
		});
	});
});
