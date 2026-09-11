import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { ensureCurrentBudgetItem } from '../../src/domain/budgets/budgetEngine';
import { BudgetRepository, BudgetItemRepository } from '../../src/data/dexie/budgetRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import type { Budget } from '../../src/domain/entities';

describe('budget rollover across skipped periods', () => {
	let key: CryptoKey;
	let categoryId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('482915', randomSaltBase64());
		const category = await CategoryRepository.create(key, { name: 'Car Repairs', parentId: null });
		categoryId = category.id;
	});

	async function makeBudget(overrides: Partial<Budget> = {}): Promise<Budget> {
		return BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 5_000_00,
			rolloverEnabled: false,
			isSinkingFund: false,
			...overrides
		});
	}

	it('carries unspent budget forward from the immediately preceding period', async () => {
		const budget = await makeBudget({ rolloverEnabled: true });

		// June: planned 5000, spent nothing.
		await BudgetItemRepository.create(key, {
			budgetId: budget.id,
			periodStart: '2026-06-01',
			periodEnd: '2026-06-30',
			plannedAmount: 5_000_00,
			actualAmount: 0,
			rolloverInAmount: 0
		});

		const july = await ensureCurrentBudgetItem(key, budget, new Date(2026, 6, 15));
		expect(july.rolloverInAmount).toBe(5_000_00);
		expect(july.plannedAmount).toBe(10_000_00);
	});

	/**
	 * Regression: rollover looked back exactly one period, and BudgetItems are created lazily —
	 * so after any month the user didn't open the app, `prevItem` was undefined, rollover silently
	 * reset to 0, and the accumulated balance vanished. For a sinking fund, where accumulating
	 * toward a goal is the entire feature (FR-026), that destroys the number the user cares about.
	 */
	it('does not lose a sinking fund balance when periods are skipped', async () => {
		const budget = await makeBudget({ isSinkingFund: true });

		// March: 5000 planned, nothing spent. Then the user doesn't open the app until July.
		await BudgetItemRepository.create(key, {
			budgetId: budget.id,
			periodStart: '2026-03-01',
			periodEnd: '2026-03-31',
			plannedAmount: 5_000_00,
			actualAmount: 0,
			rolloverInAmount: 0
		});

		const july = await ensureCurrentBudgetItem(key, budget, new Date(2026, 6, 15));

		// March's unspent 5000, plus the allowance for the three skipped months (Apr/May/Jun).
		expect(july.rolloverInAmount).toBe(5_000_00 + 3 * 5_000_00);
		expect(july.plannedAmount).toBe(july.rolloverInAmount + 5_000_00);
	});

	it('carries only genuinely unspent money for a plain rollover budget', async () => {
		const budget = await makeBudget({ rolloverEnabled: true });

		await BudgetItemRepository.create(key, {
			budgetId: budget.id,
			periodStart: '2026-03-01',
			periodEnd: '2026-03-31',
			plannedAmount: 5_000_00,
			actualAmount: 2_000_00,
			rolloverInAmount: 0
		});

		// Skipped months do not mint an allowance here — only the 3000 actually left over.
		const july = await ensureCurrentBudgetItem(key, budget, new Date(2026, 6, 15));
		expect(july.rolloverInAmount).toBe(3_000_00);
	});

	it('never rolls a negative balance forward', async () => {
		const budget = await makeBudget({ rolloverEnabled: true });
		await BudgetItemRepository.create(key, {
			budgetId: budget.id,
			periodStart: '2026-06-01',
			periodEnd: '2026-06-30',
			plannedAmount: 5_000_00,
			actualAmount: 8_000_00, // overspent
			rolloverInAmount: 0
		});

		const july = await ensureCurrentBudgetItem(key, budget, new Date(2026, 6, 15));
		expect(july.rolloverInAmount).toBe(0);
	});

	it('starts at zero when rollover is disabled', async () => {
		const budget = await makeBudget();
		await BudgetItemRepository.create(key, {
			budgetId: budget.id,
			periodStart: '2026-06-01',
			periodEnd: '2026-06-30',
			plannedAmount: 5_000_00,
			actualAmount: 0,
			rolloverInAmount: 0
		});

		const july = await ensureCurrentBudgetItem(key, budget, new Date(2026, 6, 15));
		expect(july.rolloverInAmount).toBe(0);
		expect(july.plannedAmount).toBe(5_000_00);
	});
});
