import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { BudgetRepository, BudgetItemRepository } from '../../src/data/dexie/budgetRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import {
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
});
