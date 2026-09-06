import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { BudgetRepository, BudgetItemRepository } from '../../src/data/dexie/budgetRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('BudgetRepository + BudgetItemRepository against Dexie', () => {
	let key: CryptoKey;
	let categoryId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('6666', randomSaltBase64());
		const category = await CategoryRepository.create(key, { name: 'Dining' });
		categoryId = category.id;
	});

	it('creates, updates, and lists budgets', async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 8000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		expect((await BudgetRepository.list(key)).map((b) => b.id)).toContain(budget.id);

		const updated = await BudgetRepository.update(key, budget.id, { amount: 9000 });
		expect(updated.amount).toBe(9000);
		expect((await BudgetRepository.getById(key, budget.id))?.amount).toBe(9000);
	});

	it('creates and finds a budget item by period, and updates it', async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 5000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		const item = await BudgetItemRepository.create(key, {
			budgetId: budget.id,
			periodStart: '2026-04-01',
			periodEnd: '2026-04-30',
			plannedAmount: 5000,
			actualAmount: 0,
			rolloverInAmount: 0
		});

		const found = await BudgetItemRepository.findForPeriod(key, budget.id, '2026-04-01');
		expect(found?.id).toBe(item.id);

		const updated = await BudgetItemRepository.update(key, item.id, { actualAmount: 1200 });
		expect(updated.actualAmount).toBe(1200);
	});

	it('lists all items for a budget, newest period first', async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 1000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		await BudgetItemRepository.create(key, {
			budgetId: budget.id,
			periodStart: '2026-01-01',
			periodEnd: '2026-01-31',
			plannedAmount: 1000,
			actualAmount: 0,
			rolloverInAmount: 0
		});
		await BudgetItemRepository.create(key, {
			budgetId: budget.id,
			periodStart: '2026-02-01',
			periodEnd: '2026-02-28',
			plannedAmount: 1000,
			actualAmount: 0,
			rolloverInAmount: 0
		});

		const items = await BudgetItemRepository.listForBudget(key, budget.id);
		expect(items).toHaveLength(2);
		expect(items[0].periodStart).toBe('2026-02-01');
	});
});
