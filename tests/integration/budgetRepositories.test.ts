import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { NOT_DELETED } from '../../src/data/dexie/indexable';
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

	// spec 017, FR-013/FR-014: soft-delete a budget with an in-toast undo (BudgetsPage.tsx),
	// never touching its historical BudgetItem actuals.
	describe('soft-delete / restore (spec 017)', () => {
		it('excludes a soft-deleted budget from list() and restore() brings it back', async () => {
			const budget = await BudgetRepository.create(key, {
				categoryId,
				periodType: 'monthly',
				amount: 8000,
				rolloverEnabled: false,
				isSinkingFund: false
			});
			expect((await BudgetRepository.list(key)).map((b) => b.id)).toContain(budget.id);

			await BudgetRepository.softDelete(key, budget.id);
			expect((await BudgetRepository.list(key)).map((b) => b.id)).not.toContain(budget.id);
			// getById is deliberately not filtered — BudgetsPage's undo path needs to read a
			// just-deleted budget back.
			expect((await BudgetRepository.getById(key, budget.id))?.deletedAt).not.toBeNull();

			await BudgetRepository.restore(key, budget.id);
			expect((await BudgetRepository.list(key)).map((b) => b.id)).toContain(budget.id);
			expect((await BudgetRepository.getById(key, budget.id))?.deletedAt).toBeNull();
		});

		it('FR-014: soft-deleting a budget never touches its historical BudgetItem actuals', async () => {
			const budget = await BudgetRepository.create(key, {
				categoryId,
				periodType: 'monthly',
				amount: 5000,
				rolloverEnabled: false,
				isSinkingFund: false
			});
			const item = await BudgetItemRepository.create(key, {
				budgetId: budget.id,
				periodStart: '2026-01-01',
				periodEnd: '2026-01-31',
				plannedAmount: 5000,
				actualAmount: 3200,
				rolloverInAmount: 0
			});

			await BudgetRepository.softDelete(key, budget.id);

			const itemsAfterDelete = await BudgetItemRepository.listForBudget(key, budget.id);
			expect(itemsAfterDelete).toHaveLength(1);
			expect(itemsAfterDelete[0].id).toBe(item.id);
			expect(itemsAfterDelete[0].actualAmount).toBe(3200);
			expect(itemsAfterDelete[0].plannedAmount).toBe(5000);
		});
	});

	// spec 017, research.md §1: the v11 migration backfills deletedAt on every pre-existing
	// budget row so BudgetRepository.list()'s indexed query keeps finding it. Directly exercises
	// the same `deletedAt: NOT_DELETED` transformation db.ts's version(11).upgrade() applies,
	// matching the precedent in blindIndex.test.ts's "re-indexes pre-v8 rows" case — the real
	// Dexie upgrade *trigger* is a trusted library feature; what's worth asserting here is that
	// the transformation itself correctly restores visibility.
	it('a legacy row without deletedAt is invisible to list() until the v11-style backfill runs', async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 4000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		// Simulate a row written before schema v11: no deletedAt property at all.
		const row = (await db.budgets.get(budget.id))!;
		const { deletedAt: _omit, ...legacyRow } = row as typeof row & { deletedAt?: number };
		await db.budgets.put(legacyRow as typeof row);

		expect((await BudgetRepository.list(key)).map((b) => b.id)).not.toContain(budget.id);

		await db.budgets.toCollection().modify({ deletedAt: NOT_DELETED });

		expect((await BudgetRepository.list(key)).map((b) => b.id)).toContain(budget.id);
	});
});
