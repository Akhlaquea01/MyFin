import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TagRepository, TransactionTagRepository } from '../../src/data/dexie/tagRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { resolveMerchant } from '../../src/domain/parser/merchantResolver';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// Review lets every field of a waiting entry be corrected before it is confirmed. Editing goes
// through the same engine call as the Transactions page, and must leave the entry in the queue.
describe('editing an entry that is waiting in Review', () => {
	let key: CryptoKey;
	let checking: string;
	let savings: string;
	let txId: string;
	let foodId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8383', randomSaltBase64());
		const make = (name: string) =>
			AccountRepository.create(key, {
				name,
				type: 'bank',
				openingBalance: 100_000,
				creditLimit: null,
				billingCycleDay: null
			});
		checking = (await make('Checking')).id;
		savings = (await make('Savings')).id;
		foodId = (await CategoryRepository.create(key, { name: 'Food', parentId: null, icon: null }))
			.id;
		txId = (
			await TransactionEngine.recordTransaction(key, {
				accountId: checking,
				date: '2026-10-01',
				amount: -25_000,
				type: 'expense',
				source: 'quick_add',
				reviewStatus: 'unreviewed'
			})
		).id;
	});

	const balance = async (id: string) => (await AccountRepository.getById(key, id))!.currentBalance;

	it('changes account, type, amount, date, merchant and notes, and stays unreviewed', async () => {
		const merchant = await resolveMerchant(key, 'SWIGGY');
		await TransactionEngine.editTransaction(
			key,
			txId,
			{
				accountId: savings,
				date: '2026-10-03',
				amount: 40_000,
				type: 'income',
				merchantId: merchant.merchantId,
				notes: 'refund'
			},
			[{ categoryId: foodId, amount: 40_000 }]
		);

		const edited = (await TransactionRepository.getById(key, txId))!;
		expect(edited).toMatchObject({
			accountId: savings,
			date: '2026-10-03',
			amount: 40_000,
			type: 'income',
			merchantId: merchant.merchantId,
			notes: 'refund',
			reviewStatus: 'unreviewed'
		});
		expect(await TransactionRepository.countUnreviewed()).toBe(1);
		// Both accounts follow the move: the old one is back to its opening balance.
		expect(await balance(checking)).toBe(100_000);
		expect(await balance(savings)).toBe(140_000);
	});

	it('keeps tags and the chosen category through the edit, and can still be confirmed afterwards', async () => {
		const tag = await TagRepository.getOrCreate(key, 'lunch');
		await TransactionTagRepository.setTags(txId, [tag.id]);
		await TransactionEngine.editTransaction(key, txId, { amount: -30_000 }, [
			{ categoryId: foodId, amount: -30_000 }
		]);

		expect((await TransactionRepository.getSplits(key, txId))[0].categoryId).toBe(foodId);
		expect(await TransactionTagRepository.getTagIds(txId)).toEqual([tag.id]);

		await TransactionEngine.confirmTransaction(key, txId);
		const confirmed = (await TransactionRepository.getById(key, txId))!;
		expect(confirmed.reviewStatus).toBe('confirmed');
		expect(confirmed.amount).toBe(-30_000);
		expect(await TransactionRepository.countUnreviewed()).toBe(0);
		expect(await balance(checking)).toBe(70_000);
	});

	it('does not create the merchant twice when the edit names an existing one', async () => {
		const first = await resolveMerchant(key, 'SWIGGY');
		const again = await resolveMerchant(key, 'SWIGGY');
		expect(again.merchantId).toBe(first.merchantId);
		expect((await MerchantRepository.list(key)).filter((m) => m.name === 'SWIGGY')).toHaveLength(1);
	});
});
