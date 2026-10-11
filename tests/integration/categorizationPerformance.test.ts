import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../src/data/dexie/transactionRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import {
	applyAutoCategorization,
	createKeywordPreviewer,
	previewKeywordRule,
	setMerchantRule
} from '../../src/domain/categorization/resolveCategorization';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// On a ledger with a big import waiting to be categorized, these paths used to decrypt everything
// uncategorized on every keystroke / every run. The results must be identical; the work must not be.
describe('categorization on a large uncategorized set', () => {
	let key: CryptoKey;
	let accountId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8282', randomSaltBase64());
		accountId = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
	});
	afterEach(() => vi.restoreAllMocks());

	const record = (notes: string | null, overrides: Record<string, unknown> = {}) =>
		TransactionEngine.recordTransaction(key, {
			accountId,
			date: '2026-03-01',
			amount: -100,
			type: 'expense',
			notes,
			...overrides
		});

	describe('createKeywordPreviewer', () => {
		it('reads the uncategorized entries once, however many keystrokes it answers', async () => {
			await record('UPI-SWIGGY-1');
			await record('Swiggy Instamart');
			await record('Zomato dinner');
			const listSpy = vi.spyOn(TransactionRepository, 'listUncategorized');
			const merchantSpy = vi.spyOn(MerchantRepository, 'list');

			const previewer = createKeywordPreviewer(key);
			// What typing "swiggy" produces: every prefix of it, one after another.
			const counts: number[] = [];
			for (const typed of ['swi', 'swig', 'swigg', 'swiggy']) {
				counts.push((await previewer.preview(typed)).count);
			}
			expect(counts).toEqual([2, 2, 2, 2]);
			expect((await previewer.preview('zomato')).count).toBe(1);
			expect((await previewer.preview('nothing')).count).toBe(0);

			expect(listSpy).toHaveBeenCalledTimes(1);
			expect(merchantSpy).toHaveBeenCalledTimes(1);
		});

		it('gives exactly the answers the one-off previewKeywordRule gives', async () => {
			const merchant = await MerchantRepository.create(key, 'Swiggy Corporate');
			await record('UPI-SWIGGY-1');
			await record('Swiggy Instamart');
			await record(null, { merchantId: merchant.id });
			await record('Zomato dinner');

			const previewer = createKeywordPreviewer(key);
			for (const keyword of ['swiggy', 'zomato', 'instamart', 'corporate', 'absent']) {
				expect(await previewer.preview(keyword)).toEqual(await previewKeywordRule(key, keyword));
			}
			// The merchant-only entry (no description) is found through its merchant's name.
			expect((await previewer.preview('corporate')).count).toBe(1);
		});

		it('is empty and does no merchant lookup when nothing is uncategorized', async () => {
			const merchantSpy = vi.spyOn(MerchantRepository, 'list');
			const previewer = createKeywordPreviewer(key);
			expect(await previewer.preview('swiggy')).toEqual({ count: 0, samples: [] });
			expect(merchantSpy).not.toHaveBeenCalled();
		});

		it('limits and de-duplicates its examples', async () => {
			for (let i = 0; i < 6; i++) await record(`Swiggy order ${i}`);
			await record('Swiggy order 0');
			const result = await createKeywordPreviewer(key).preview('swiggy', 3);
			expect(result.count).toBe(7);
			expect(result.samples).toHaveLength(3);
			expect(new Set(result.samples).size).toBe(3);
		});
	});

	describe('listUncategorized({ unreviewedOnly })', () => {
		it('returns only entries waiting in Review, chosen before anything is decrypted', async () => {
			const queued = await record('queued', { reviewStatus: 'unreviewed', source: 'file_import' });
			await record('confirmed 1');
			await record('confirmed 2');

			const all = await TransactionRepository.listUncategorized(key);
			expect(all).toHaveLength(3);
			const waiting = await TransactionRepository.listUncategorized(key, { unreviewedOnly: true });
			expect(waiting.map((t) => t.id)).toEqual([queued.id]);
		});
	});

	describe('splitCountsByTransaction', () => {
		it('counts splits per transaction without needing the key', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const single = await record('single');
			const split = await TransactionEngine.recordTransaction(
				key,
				{ accountId, date: '2026-03-01', amount: -100, type: 'expense', notes: 'split' },
				[
					{ categoryId: food.id, amount: -60 },
					{ categoryId: UNCATEGORIZED_CATEGORY_ID, amount: -40 }
				]
			);
			const counts = await TransactionRepository.splitCountsByTransaction([
				single.id,
				split.id,
				'unknown'
			]);
			expect(counts.get(single.id)).toBe(1);
			expect(counts.get(split.id)).toBe(2);
			expect(counts.has('unknown')).toBe(false);
			expect((await TransactionRepository.splitCountsByTransaction([])).size).toBe(0);
		});
	});

	describe('applyAutoCategorization', () => {
		it('does not decrypt any split just to find out whether an entry is split', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const merchant = await MerchantRepository.create(key, 'Swiggy');
			await record('a', { merchantId: merchant.id });
			await record('b', { merchantId: merchant.id });
			await setMerchantRule(key, merchant.id, food.id);
			const splitsSpy = vi.spyOn(TransactionRepository, 'splitsByTransaction');

			const { updated } = await applyAutoCategorization(key, { merchantId: merchant.id });
			expect(updated).toBe(2);
			expect(splitsSpy).not.toHaveBeenCalled();
		});

		it('with unreviewedOnly, files the queue and leaves older confirmed entries alone', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const merchant = await MerchantRepository.create(key, 'Swiggy');
			const old = await record('old', { merchantId: merchant.id });
			const queued = await record('queued', {
				merchantId: merchant.id,
				reviewStatus: 'unreviewed',
				source: 'file_import'
			});
			await setMerchantRule(key, merchant.id, food.id);

			expect(
				(await applyAutoCategorization(key, { unreviewedOnly: true, dryRun: true })).updated
			).toBe(1);
			await applyAutoCategorization(key, { unreviewedOnly: true });

			const category = async (id: string) => (await TransactionRepository.getSplits(key, id))[0];
			expect((await category(queued.id)).categoryId).toBe(food.id);
			expect((await category(old.id)).categoryId).toBe(UNCATEGORIZED_CATEGORY_ID);
		});
	});
});
