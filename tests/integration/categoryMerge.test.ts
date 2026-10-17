import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { BudgetRepository } from '../../src/data/dexie/budgetRepository';
import { CategorizationRuleRepository } from '../../src/data/dexie/categorizationRuleRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { MerchantCategorySignalRepository } from '../../src/data/dexie/merchantCategorySignalRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import { RecurringRepository } from '../../src/data/dexie/recurringRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../src/data/dexie/transactionRepository';
import {
	countCategoryReferences,
	moveAndRemoveCategory
} from '../../src/domain/categories/categoryEngine';
import { categoryActivity } from '../../src/domain/analytics/analyticsEngine';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// Deleting or merging a category must take everything attached to it along: transactions, budgets,
// recurring rules, categorization rules and the merchant-learning streaks. Before, a deleted
// category left all but the transactions pointing at an id that no longer existed.
describe('moving and removing a category', () => {
	let key: CryptoKey;
	let account: string;
	let food: string;
	let groceries: string;
	let dining: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('6161', randomSaltBase64());
		account = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
		food = (await CategoryRepository.create(key, { name: 'Food' })).id;
		groceries = (await CategoryRepository.create(key, { name: 'Groceries', parentId: food })).id;
		dining = (await CategoryRepository.create(key, { name: 'Dining' })).id;
	});

	const spend = (categoryId: string, amount = 10_000, date = '2026-03-05') =>
		TransactionEngine.recordTransaction(
			key,
			{ accountId: account, date, amount: -amount, type: 'expense' },
			[{ categoryId, amount: -amount }]
		);
	const categoryOf = async (txId: string) =>
		(await TransactionRepository.getSplits(key, txId))[0].categoryId;
	const ids = async () => (await CategoryRepository.list(key)).map((c) => c.id);
	const monthlyBudget = (categoryId: string, amount = 50_000) =>
		BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount,
			rolloverEnabled: false,
			isSinkingFund: false
		});

	it('merges one category into another: transactions, budget, recurring rule, rule and streak all follow', async () => {
		const tx = await spend(groceries);
		const budget = await monthlyBudget(groceries);
		const recurring = await RecurringRepository.create(key, {
			accountId: account,
			categoryId: groceries,
			amount: -10_000,
			frequency: 'monthly',
			dayOfPeriod: 5
		});
		const merchant = await MerchantRepository.create(key, 'BigBasket');
		const rule = await CategorizationRuleRepository.create(key, {
			merchantId: merchant.id,
			categoryId: groceries
		});
		await MerchantCategorySignalRepository.set(key, merchant.id, [groceries, dining, groceries]);

		const moved = await moveAndRemoveCategory(key, groceries, dining);

		expect(moved).toMatchObject({ transactions: 1, budgets: 1, recurringRules: 1, rules: 1 });
		expect(await ids()).not.toContain(groceries);
		expect(await categoryOf(tx.id)).toBe(dining);
		expect((await BudgetRepository.getById(key, budget.id))?.categoryId).toBe(dining);
		expect(
			(await RecurringRepository.list(key)).find((r) => r.id === recurring.id)?.categoryId
		).toBe(dining);
		expect((await CategorizationRuleRepository.getById(key, rule.id))?.categoryId).toBe(dining);
		expect(
			(await MerchantCategorySignalRepository.get(key, merchant.id))?.recentCategoryIds
		).toEqual([dining, dining, dining]);
	});

	it('keeps the target’s budget when both have one, since a category has a single budget', async () => {
		const mine = await monthlyBudget(groceries, 50_000);
		const theirs = await monthlyBudget(dining, 20_000);
		await moveAndRemoveCategory(key, groceries, dining);
		expect(await BudgetRepository.getById(key, mine.id)).toBeNull();
		expect((await BudgetRepository.getById(key, theirs.id))?.amount).toBe(20_000);
	});

	it('deleting into Uncategorized re-files the transactions and drops the budget and rules that cannot apply', async () => {
		const tx = await spend(groceries);
		const budget = await monthlyBudget(groceries);
		const merchant = await MerchantRepository.create(key, 'BigBasket');
		const rule = await CategorizationRuleRepository.create(key, {
			merchantId: merchant.id,
			categoryId: groceries
		});
		await MerchantCategorySignalRepository.set(key, merchant.id, [groceries, dining]);

		await moveAndRemoveCategory(key, groceries, null);

		expect(await categoryOf(tx.id)).toBe(UNCATEGORIZED_CATEGORY_ID);
		expect(await BudgetRepository.getById(key, budget.id)).toBeNull();
		expect(await CategorizationRuleRepository.getById(key, rule.id)).toBeNull();
		expect(
			(await MerchantCategorySignalRepository.get(key, merchant.id))?.recentCategoryIds
		).toEqual([dining]);
	});

	it('refuses to remove a parent that still has subcategories, unless they are moved too', async () => {
		await expect(moveAndRemoveCategory(key, food, dining)).rejects.toThrow(
			/still has 1 subcategory/
		);
		expect(await ids()).toContain(food);

		await moveAndRemoveCategory(key, food, dining, { moveSubcategories: true });
		const after = await CategoryRepository.list(key);
		expect(after.find((c) => c.id === food)).toBeUndefined();
		expect(after.find((c) => c.id === groceries)?.parentId).toBe(dining);
	});

	it('moves subcategories up a level when the parent goes to Uncategorized', async () => {
		const top = await CategoryRepository.create(key, { name: 'Bills' });
		const mid = await CategoryRepository.create(key, { name: 'Utilities', parentId: top.id });
		const leaf = await CategoryRepository.create(key, { name: 'Power', parentId: mid.id });
		await moveAndRemoveCategory(key, mid.id, null, { moveSubcategories: true });
		expect((await CategoryRepository.list(key)).find((c) => c.id === leaf.id)?.parentId).toBe(
			top.id
		);
	});

	it('refuses to move a category into itself or below itself, or into one that is gone', async () => {
		await expect(
			moveAndRemoveCategory(key, food, groceries, { moveSubcategories: true })
		).rejects.toThrow(/not Food or inside it/);
		await expect(moveAndRemoveCategory(key, dining, dining)).rejects.toThrow(
			/not Dining or inside it/
		);
		await expect(moveAndRemoveCategory(key, dining, 'nope')).rejects.toThrow(/no longer exists/);
		await expect(moveAndRemoveCategory(key, 'nope', dining)).rejects.toThrow(/no longer exists/);
		expect(await ids()).toContain(dining);
	});

	it('counts what is attached to a category', async () => {
		await spend(groceries);
		await spend(groceries, 5_000, '2026-03-06');
		await monthlyBudget(groceries, 1);
		expect(await countCategoryReferences(key, groceries)).toEqual({
			splits: 2,
			budgets: 1,
			recurring: 0,
			rules: 0
		});
		expect(await countCategoryReferences(key, dining)).toEqual({
			splits: 0,
			budgets: 0,
			recurring: 0,
			rules: 0
		});
	});
});

describe('categoryActivity', () => {
	let key: CryptoKey;
	let account: string;
	let food: string;
	let salary: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('6262', randomSaltBase64());
		account = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
		food = (await CategoryRepository.create(key, { name: 'Food' })).id;
		salary = (await CategoryRepository.create(key, { name: 'Salary' })).id;
	});

	it('totals money out and money in per category, counting a split entry once, and skips transfers', async () => {
		await TransactionEngine.recordTransaction(
			key,
			{ accountId: account, date: '2026-03-05', amount: -30_000, type: 'expense' },
			[
				{ categoryId: food, amount: -10_000 },
				{ categoryId: food, amount: -20_000 }
			]
		);
		await TransactionEngine.recordTransaction(
			key,
			{ accountId: account, date: '2026-03-06', amount: -5_000, type: 'expense' },
			[{ categoryId: food, amount: -5_000 }]
		);
		await TransactionEngine.recordTransaction(
			key,
			{ accountId: account, date: '2026-03-07', amount: 900_000, type: 'income' },
			[{ categoryId: salary, amount: 900_000 }]
		);
		await TransactionEngine.recordTransaction(key, {
			accountId: account,
			date: '2026-03-08',
			amount: -1_000,
			type: 'expense'
		});
		// Outside the range.
		await TransactionEngine.recordTransaction(
			key,
			{ accountId: account, date: '2026-04-01', amount: -7_000, type: 'expense' },
			[{ categoryId: food, amount: -7_000 }]
		);

		const activity = await categoryActivity(key, '2026-03-01', '2026-03-31');
		const of = (id: string) => activity.find((a) => a.categoryId === id);
		expect(of(food)).toEqual({
			categoryId: food,
			expense: 35_000,
			income: 0,
			expenseCount: 2,
			incomeCount: 0
		});
		expect(of(salary)).toMatchObject({ income: 900_000, incomeCount: 1, expense: 0 });
		expect(of(UNCATEGORIZED_CATEGORY_ID)).toMatchObject({ expense: 1_000, expenseCount: 1 });
	});
});
