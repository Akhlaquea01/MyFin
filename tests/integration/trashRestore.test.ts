import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { BudgetRepository } from '../../src/data/dexie/budgetRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import {
	InvestmentHoldingRepository,
	LiabilityRepository
} from '../../src/data/dexie/wealthRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// Holdings, liabilities and budgets are deleted with an Undo toast. Trash is where they can still be
// found once the toast is gone.
describe('Trash for holdings, liabilities and budgets', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8787', randomSaltBase64());
	});

	const holding = (name: string) =>
		InvestmentHoldingRepository.create(key, { name, type: 'stock', costBasis: 1000 });
	const liability = (name: string) =>
		LiabilityRepository.create(key, {
			name,
			type: 'loan',
			outstandingBalance: 50_000,
			emiAmount: null,
			emiDueDay: null,
			interestRate: null,
			minimumPayment: null
		});
	const budget = (categoryId: string) =>
		BudgetRepository.create(key, {
			categoryId,
			periodType: 'monthly',
			amount: 10_000,
			rolloverEnabled: false,
			isSinkingFund: false
		});

	describe('holdings', () => {
		it('lists only deleted ones, latest deletion first, and restores them', async () => {
			const keep = await holding('Keep');
			const first = await holding('First');
			const second = await holding('Second');
			await InvestmentHoldingRepository.softDelete(key, first.id);
			await new Promise((resolve) => setTimeout(resolve, 5));
			await InvestmentHoldingRepository.softDelete(key, second.id);

			expect((await InvestmentHoldingRepository.listDeleted(key)).map((h) => h.name)).toEqual([
				'Second',
				'First'
			]);
			expect((await InvestmentHoldingRepository.list(key)).map((h) => h.id)).toEqual([keep.id]);

			await InvestmentHoldingRepository.restore(key, first.id);
			expect((await InvestmentHoldingRepository.listDeleted(key)).map((h) => h.name)).toEqual([
				'Second'
			]);
			expect((await InvestmentHoldingRepository.list(key)).map((h) => h.name).sort()).toEqual([
				'First',
				'Keep'
			]);
		});
	});

	describe('liabilities', () => {
		it('lists only deleted ones and restores them with their balance', async () => {
			await liability('Live');
			const gone = await liability('Car loan');
			await LiabilityRepository.softDelete(key, gone.id);

			const deleted = await LiabilityRepository.listDeleted(key);
			expect(deleted.map((l) => l.name)).toEqual(['Car loan']);
			expect(deleted[0].outstandingBalance).toBe(50_000);

			await LiabilityRepository.restore(key, gone.id);
			expect(await LiabilityRepository.listDeleted(key)).toEqual([]);
			expect((await LiabilityRepository.list(key)).map((l) => l.name).sort()).toEqual([
				'Car loan',
				'Live'
			]);
		});
	});

	describe('budgets', () => {
		it('lists only deleted ones and restores them', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const gone = await budget(food.id);
			await BudgetRepository.softDelete(key, gone.id);

			expect((await BudgetRepository.listDeleted(key)).map((b) => b.id)).toEqual([gone.id]);
			expect(await BudgetRepository.list(key)).toEqual([]);

			await BudgetRepository.restore(key, gone.id);
			expect(await BudgetRepository.listDeleted(key)).toEqual([]);
			expect((await BudgetRepository.list(key)).map((b) => b.id)).toEqual([gone.id]);
		});

		it('will not restore one whose category has since been given another budget', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const old = await budget(food.id);
			await BudgetRepository.softDelete(key, old.id);
			const replacement = await budget(food.id);

			await expect(BudgetRepository.restore(key, old.id)).rejects.toThrow(/another active budget/);
			// Nothing changed: the old one is still in the Trash, the new one still alone.
			expect((await BudgetRepository.listDeleted(key)).map((b) => b.id)).toEqual([old.id]);
			expect((await BudgetRepository.list(key)).map((b) => b.id)).toEqual([replacement.id]);

			// Once the rival is gone, it can come back.
			await BudgetRepository.softDelete(key, replacement.id);
			await BudgetRepository.restore(key, old.id);
			expect((await BudgetRepository.list(key)).map((b) => b.id)).toEqual([old.id]);
		});

		it('restores a budget on a different category without complaint', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const travel = await CategoryRepository.create(key, { name: 'Travel' });
			const foodBudget = await budget(food.id);
			await budget(travel.id);
			await BudgetRepository.softDelete(key, foodBudget.id);
			await BudgetRepository.restore(key, foodBudget.id);
			expect(await BudgetRepository.list(key)).toHaveLength(2);
		});

		it('says so when asked to restore a budget that does not exist', async () => {
			await expect(BudgetRepository.restore(key, 'missing')).rejects.toThrow(/not found/);
		});
	});
});
