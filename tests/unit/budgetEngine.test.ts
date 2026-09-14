import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { BudgetRepository, BudgetItemRepository } from '../../src/data/dexie/budgetRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import {
	ensureBudgetItemForPeriod,
	ensureCurrentBudgetItem,
	getCurrentPeriodRange,
	recalcActualAmount
} from '../../src/domain/budgets/budgetEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Budget engine', () => {
	let key: CryptoKey;
	let categoryId: string;
	let accountId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('5555', randomSaltBase64());
		const category = await CategoryRepository.create(key, { name: 'Groceries' });
		categoryId = category.id;
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
	});

	it('starts a new budget period at 0 spent with the full amount available', async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 10000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		const referenceDate = new Date('2026-03-15T00:00:00Z');
		const item = await ensureCurrentBudgetItem(key, budget, referenceDate);
		expect(item.plannedAmount).toBe(10000);
		expect(item.actualAmount).toBe(0);
		expect(item.periodStart).toBe('2026-03-01');
		expect(item.periodEnd).toBe('2026-03-31');
	});

	it('reflects a mid-period edit to the budget amount in the already-created current-period item', async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 10000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		const referenceDate = new Date('2026-03-15T00:00:00Z');
		const firstItem = await ensureCurrentBudgetItem(key, budget, referenceDate);
		expect(firstItem.plannedAmount).toBe(10000);

		const updatedBudget = await BudgetRepository.update(key, budget.id, { amount: 25000 });
		const secondItem = await ensureCurrentBudgetItem(key, updatedBudget, referenceDate);
		expect(secondItem.id).toBe(firstItem.id);
		expect(secondItem.plannedAmount).toBe(25000);
	});

	it("tracks actual spend against the category's transactions for the period", async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 10000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-03-05', amount: -3000, type: 'expense' },
			[{ categoryId, amount: -3000 }]
		);
		// Outside the period — must not count.
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-04-01', amount: -1000, type: 'expense' },
			[{ categoryId, amount: -1000 }]
		);

		const actual = await recalcActualAmount(
			key,
			categoryId,
			...(Object.values(getCurrentPeriodRange('monthly', new Date('2026-03-15T00:00:00Z'))) as [
				string,
				string
			])
		);
		expect(actual).toBe(3000);

		const item = await ensureCurrentBudgetItem(key, budget, new Date('2026-03-20T00:00:00Z'));
		expect(item.actualAmount).toBe(3000);
	});

	it('rolls unused amount into the next period when rollover is enabled', async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 10000,
			rolloverEnabled: true,
			isSinkingFund: false
		});
		// February: spend only 4000 of 10000 planned.
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-02-10', amount: -4000, type: 'expense' },
			[{ categoryId, amount: -4000 }]
		);
		await ensureCurrentBudgetItem(key, budget, new Date('2026-02-15T00:00:00Z'));

		// March: should inherit 6000 rollover, so planned = 10000 + 6000.
		const marchItem = await ensureCurrentBudgetItem(key, budget, new Date('2026-03-15T00:00:00Z'));
		expect(marchItem.rolloverInAmount).toBe(6000);
		expect(marchItem.plannedAmount).toBe(16000);
	});

	it('indicates overspending when actual exceeds planned', async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 5000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		await TransactionRepository.create(
			key,
			{ accountId, date: '2026-03-05', amount: -7000, type: 'expense' },
			[{ categoryId, amount: -7000 }]
		);
		const item = await ensureCurrentBudgetItem(key, budget, new Date('2026-03-20T00:00:00Z'));
		expect(item.actualAmount).toBeGreaterThan(item.plannedAmount);
	});

	it('accumulates a sinking fund across periods even without rolloverEnabled set', async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 2000,
			rolloverEnabled: false,
			isSinkingFund: true
		});
		await ensureCurrentBudgetItem(key, budget, new Date('2026-01-15T00:00:00Z'));
		const feb = await ensureCurrentBudgetItem(key, budget, new Date('2026-02-15T00:00:00Z'));
		expect(feb.rolloverInAmount).toBe(2000);
		expect(feb.plannedAmount).toBe(4000);
	});

	it('is idempotent: calling ensureCurrentBudgetItem twice for the same period does not duplicate it', async () => {
		const budget = await BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 1000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		const referenceDate = new Date('2026-03-15T00:00:00Z');
		await ensureCurrentBudgetItem(key, budget, referenceDate);
		await ensureCurrentBudgetItem(key, budget, referenceDate);
		const items = await BudgetItemRepository.listForBudget(key, budget.id);
		expect(items).toHaveLength(1);
	});

	// spec 016, FR-010/FR-011: ensureBudgetItemForPeriod generalizes ensureCurrentBudgetItem to
	// any reference date, powering both month-wise history navigation and the post-import
	// recompute that fixes stale/imported budget totals.
	describe('ensureBudgetItemForPeriod (spec 016)', () => {
		it('creates a BudgetItem for an arbitrary past period with no existing row', async () => {
			const budget = await BudgetRepository.create(key, {
				categoryId,
				periodType: 'monthly',
				amount: 10000,
				rolloverEnabled: false,
				isSinkingFund: false
			});
			await TransactionRepository.create(
				key,
				{ accountId, date: '2025-06-10', amount: -2500, type: 'expense' },
				[{ categoryId, amount: -2500 }]
			);

			const item = await ensureBudgetItemForPeriod(key, budget, new Date('2025-06-15T00:00:00Z'));
			expect(item.periodStart).toBe('2025-06-01');
			expect(item.plannedAmount).toBe(10000);
			expect(item.actualAmount).toBe(2500);
		});

		it("corrects a stale actualAmount on an already-existing BudgetItem (the imported-json bug)", async () => {
			const budget = await BudgetRepository.create(key, {
				categoryId,
				periodType: 'monthly',
				amount: 10000,
				rolloverEnabled: false,
				isSinkingFund: false
			});
			// Simulate an imported BudgetItem whose actualAmount was trusted verbatim from a file,
			// with no transactions yet on record to justify it.
			const stale = await BudgetItemRepository.create(key, {
				budgetId: budget.id,
				periodStart: '2025-06-01',
				periodEnd: '2025-06-30',
				plannedAmount: 10000,
				actualAmount: 999999,
				rolloverInAmount: 0
			});

			// The real transactions land afterwards, as they would when import processes
			// budgetItems (step 13) before transactions (step 21).
			await TransactionRepository.create(
				key,
				{ accountId, date: '2025-06-10', amount: -4000, type: 'expense' },
				[{ categoryId, amount: -4000 }]
			);

			const corrected = await ensureBudgetItemForPeriod(
				key,
				budget,
				new Date('2025-06-15T00:00:00Z')
			);
			expect(corrected.id).toBe(stale.id);
			expect(corrected.actualAmount).toBe(4000);
		});

		it('ensureCurrentBudgetItem remains a thin wrapper for referenceDate = now', async () => {
			const budget = await BudgetRepository.create(key, {
				categoryId,
				periodType: 'monthly',
				amount: 5000,
				rolloverEnabled: false,
				isSinkingFund: false
			});
			const now = new Date();
			const viaWrapper = await ensureCurrentBudgetItem(key, budget, now);
			const viaGeneral = await ensureBudgetItemForPeriod(key, budget, now);
			expect(viaGeneral.id).toBe(viaWrapper.id);
			expect(viaGeneral.periodStart).toBe(viaWrapper.periodStart);
		});
	});
});
