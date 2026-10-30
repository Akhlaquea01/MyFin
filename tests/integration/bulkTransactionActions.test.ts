import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../src/data/dexie/transactionRepository';
import { PersonRepository, PersonLoanRepository } from '../../src/data/dexie/personLoanRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { bulkDeleteTransactions, bulkSetCategory } from '../../src/domain/transactions/bulkActions';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('bulk transaction actions', () => {
	let key: CryptoKey;
	let checking: string;
	let savings: string;

	const balance = async (id: string) => (await AccountRepository.getById(key, id))!.currentBalance;
	const spend = async (amount: number, accountId = checking) =>
		(
			await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-02-10',
				amount: -amount,
				type: 'expense'
			})
		).id;
	const categoryOf = async (id: string) =>
		(await TransactionRepository.getSplits(key, id)).map((s) => s.categoryId);

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('6262', randomSaltBase64());
		const make = async (name: string, openingBalance: number) =>
			(
				await AccountRepository.create(key, {
					name,
					type: 'bank',
					openingBalance,
					creditLimit: null,
					billingCycleDay: null
				})
			).id;
		checking = await make('Checking', 100_000);
		savings = await make('Savings', 50_000);
	});

	describe('bulkDeleteTransactions', () => {
		it('deletes every selected entry and keeps the balance equal to opening plus what is left', async () => {
			const a = await spend(1000);
			const b = await spend(2000);
			const kept = await spend(4000);
			expect(await balance(checking)).toBe(93_000);

			const result = await bulkDeleteTransactions(key, [a, b]);

			expect(result).toEqual({ deleted: 2, linked: 0, failed: 0 });
			expect((await TransactionRepository.search(key)).map((t) => t.id)).toEqual([kept]);
			expect(await balance(checking)).toBe(96_000);
		});

		it('counts an id given twice once', async () => {
			const a = await spend(1000);
			const result = await bulkDeleteTransactions(key, [a, a]);
			expect(result).toEqual({ deleted: 1, linked: 0, failed: 0 });
		});

		it('removes both legs of a transfer when both are selected, with no failure', async () => {
			const [out, into] = await TransactionEngine.recordTransfer(key, {
				fromAccountId: checking,
				toAccountId: savings,
				amount: 5000,
				date: '2026-02-11'
			});

			const result = await bulkDeleteTransactions(key, [out.id, into.id]);

			expect(result).toEqual({ deleted: 2, linked: 0, failed: 0 });
			expect(await TransactionRepository.search(key)).toEqual([]);
			expect(await balance(checking)).toBe(100_000);
			expect(await balance(savings)).toBe(50_000);
		});

		it('removes the whole transfer when only one leg is selected', async () => {
			const [out] = await TransactionEngine.recordTransfer(key, {
				fromAccountId: checking,
				toAccountId: savings,
				amount: 5000,
				date: '2026-02-11'
			});

			await bulkDeleteTransactions(key, [out.id]);

			expect(await TransactionRepository.search(key)).toEqual([]);
			expect(await balance(savings)).toBe(50_000);
		});

		it('leaves an entry that belongs to a loan alone and still deletes the rest', async () => {
			const person = await PersonRepository.create(key, { name: 'Asha' });
			const loan = await PersonLoanRepository.create(key, {
				personId: person.id,
				direction: 'lent',
				principalAmount: 3000,
				date: '2026-02-09',
				dueDate: null,
				notes: null,
				accountId: checking
			});
			const ordinary = await spend(1000);

			const result = await bulkDeleteTransactions(key, [loan.transactionId!, ordinary]);

			expect(result).toEqual({ deleted: 1, linked: 1, failed: 0 });
			expect(await TransactionRepository.getById(key, loan.transactionId!)).not.toBeNull();
			expect(await TransactionRepository.getById(key, ordinary)).toBeNull();
			expect(await balance(checking)).toBe(97_000);
		});

		it('reports an id that no longer exists as failed without touching the others', async () => {
			const a = await spend(1000);
			const result = await bulkDeleteTransactions(key, ['gone', a]);
			expect(result).toEqual({ deleted: 1, linked: 0, failed: 1 });
		});
	});

	describe('bulkSetCategory', () => {
		it('sets the category on every selected entry without moving any balance', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const a = await spend(1000);
			const b = await spend(2500);
			const before = await balance(checking);

			const result = await bulkSetCategory(key, [a, b], food.id);

			expect(result).toEqual({ updated: 2, transfers: 0, split: 0, linked: 0, failed: 0 });
			expect(await categoryOf(a)).toEqual([food.id]);
			expect(await categoryOf(b)).toEqual([food.id]);
			expect(await balance(checking)).toBe(before);
			const splits = await TransactionRepository.getSplits(key, b);
			expect(splits[0].amount).toBe(-2500);
		});

		it('replaces a previous category rather than adding a second split', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const fuel = await CategoryRepository.create(key, { name: 'Fuel' });
			const a = await spend(1000);
			await bulkSetCategory(key, [a], food.id);

			await bulkSetCategory(key, [a], fuel.id);

			expect(await categoryOf(a)).toEqual([fuel.id]);
		});

		it('skips transfers and entries already split across categories, and says how many', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const home = await CategoryRepository.create(key, { name: 'Home' });
			const target = await CategoryRepository.create(key, { name: 'Target' });
			const [out] = await TransactionEngine.recordTransfer(key, {
				fromAccountId: checking,
				toAccountId: savings,
				amount: 5000,
				date: '2026-02-11'
			});
			const split = (
				await TransactionEngine.recordTransaction(
					key,
					{ accountId: checking, date: '2026-02-12', amount: -3000, type: 'expense' },
					[
						{ categoryId: food.id, amount: -2000 },
						{ categoryId: home.id, amount: -1000 }
					]
				)
			).id;
			const plain = await spend(700);

			const result = await bulkSetCategory(key, [out.id, split, plain], target.id);

			expect(result).toEqual({ updated: 1, transfers: 1, split: 1, linked: 0, failed: 0 });
			expect((await categoryOf(split)).sort()).toEqual([food.id, home.id].sort());
			expect(await categoryOf(plain)).toEqual([target.id]);
		});

		it('can move entries back to Uncategorized', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const a = await spend(1000);
			await bulkSetCategory(key, [a], food.id);

			await bulkSetCategory(key, [a], UNCATEGORIZED_CATEGORY_ID);

			expect(await categoryOf(a)).toEqual([UNCATEGORIZED_CATEGORY_ID]);
		});

		it('leaves a loan entry alone', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const person = await PersonRepository.create(key, { name: 'Asha' });
			const loan = await PersonLoanRepository.create(key, {
				personId: person.id,
				direction: 'lent',
				principalAmount: 3000,
				date: '2026-02-09',
				dueDate: null,
				notes: null,
				accountId: checking
			});

			const result = await bulkSetCategory(key, [loan.transactionId!], food.id);

			// A loan's entry is a one-sided transfer, which has no category to set.
			expect(result.updated).toBe(0);
			expect(result.transfers + result.linked).toBe(1);
		});

		it('reports an id that no longer exists as failed', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			expect(await bulkSetCategory(key, ['gone'], food.id)).toMatchObject({
				updated: 0,
				failed: 1
			});
		});
	});
});
