import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TagRepository, TransactionTagRepository } from '../../src/data/dexie/tagRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../src/data/dexie/transactionRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// The Review Queue can hold thousands of entries after a big import. The page loads it in slices,
// so the repository has to hand out a stable newest-first slice and answer "which waiting entries
// already have a category?" without decrypting the rest.
describe('Review Queue paging', () => {
	let key: CryptoKey;
	let accountId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8383', randomSaltBase64());
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

	const queue = (
		notes: string,
		date: string,
		overrides: Record<string, unknown> = {},
		splits?: { categoryId: string; amount: number }[]
	) =>
		TransactionEngine.recordTransaction(
			key,
			{
				accountId,
				date,
				amount: -100,
				type: 'expense',
				notes,
				reviewStatus: 'unreviewed',
				source: 'file_import',
				...overrides
			},
			splits
		);

	describe('listUnreviewed', () => {
		it('returns the queue newest first, and only the queue', async () => {
			await queue('oldest', '2026-01-05');
			await queue('newest', '2026-03-09');
			await queue('middle', '2026-02-11');
			await TransactionEngine.recordTransaction(key, {
				accountId,
				date: '2026-04-01',
				amount: -5,
				type: 'expense',
				notes: 'already confirmed'
			});

			const all = await TransactionRepository.listUnreviewed(key);
			expect(all.map((t) => t.notes)).toEqual(['newest', 'middle', 'oldest']);
		});

		it('takes a slice of the newest and decrypts only that slice', async () => {
			for (let day = 1; day <= 9; day++) await queue(`entry ${day}`, `2026-03-0${day}`);

			const page = await TransactionRepository.listUnreviewed(key, { limit: 4 });
			expect(page.map((t) => t.notes)).toEqual(['entry 9', 'entry 8', 'entry 7', 'entry 6']);

			// The next, longer page starts with the same entries — "Show more" only appends.
			const longer = await TransactionRepository.listUnreviewed(key, { limit: 6 });
			expect(longer.slice(0, 4).map((t) => t.id)).toEqual(page.map((t) => t.id));
			expect(longer).toHaveLength(6);
			expect(await TransactionRepository.listUnreviewed(key, { limit: 0 })).toEqual([]);
			expect(await TransactionRepository.listUnreviewed(key, { limit: 100 })).toHaveLength(9);
		});

		it('keeps same-day entries in the same order from one load to the next', async () => {
			for (let i = 0; i < 8; i++) await queue(`same day ${i}`, '2026-03-01');
			const first = (await TransactionRepository.listUnreviewed(key, { limit: 5 })).map(
				(t) => t.id
			);
			const second = (await TransactionRepository.listUnreviewed(key, { limit: 5 })).map(
				(t) => t.id
			);
			expect(second).toEqual(first);
		});

		it('leaves discarded entries out', async () => {
			const keep = await queue('keep', '2026-03-02');
			const drop = await queue('drop', '2026-03-03');
			await TransactionEngine.deleteTransaction(key, drop.id);
			const list = await TransactionRepository.listUnreviewed(key);
			expect(list.map((t) => t.id)).toEqual([keep.id]);
			expect(await TransactionRepository.countUnreviewed()).toBe(1);
		});
	});

	describe('categorizedUnreviewedIds', () => {
		it('lists the waiting entries that already carry a category, without the rest', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const filed = await queue('filed', '2026-03-01', {}, [{ categoryId: food.id, amount: -100 }]);
			await queue('not filed', '2026-03-02');
			// Confirmed entries are not in the queue, whatever their category.
			await TransactionEngine.recordTransaction(
				key,
				{ accountId, date: '2026-03-03', amount: -7, type: 'expense', notes: 'confirmed' },
				[{ categoryId: food.id, amount: -7 }]
			);

			expect(await TransactionRepository.categorizedUnreviewedIds()).toEqual([filed.id]);
		});

		it('does not count an entry that is only partly categorized', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			await queue('half filed', '2026-03-01', {}, [
				{ categoryId: food.id, amount: -60 },
				{ categoryId: UNCATEGORIZED_CATEGORY_ID, amount: -40 }
			]);
			expect(await TransactionRepository.categorizedUnreviewedIds()).toEqual([]);
		});

		it('is empty for an empty queue and leaves out discarded entries', async () => {
			expect(await TransactionRepository.categorizedUnreviewedIds()).toEqual([]);
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const gone = await queue('gone', '2026-03-01', {}, [{ categoryId: food.id, amount: -100 }]);
			await TransactionEngine.deleteTransaction(key, gone.id);
			expect(await TransactionRepository.categorizedUnreviewedIds()).toEqual([]);
		});

		it('needs no decryption — it reads only the indexed columns', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			for (let i = 0; i < 5; i++) {
				await queue(`filed ${i}`, '2026-03-01', {}, [{ categoryId: food.id, amount: -100 }]);
			}
			const decryptSpy = vi.spyOn(crypto.subtle, 'decrypt');
			expect(await TransactionRepository.categorizedUnreviewedIds()).toHaveLength(5);
			expect(decryptSpy).not.toHaveBeenCalled();
			// Control: the spy does see decryption when rows are actually read.
			await TransactionRepository.listUnreviewed(key);
			expect(decryptSpy).toHaveBeenCalled();
		});
	});

	describe('confirming entries that are not on the page', () => {
		it('keeps the category and tags they were filed with', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const tag = await TagRepository.getOrCreate(key, 'weekly');
			const filed = await queue('filed', '2026-03-01', {}, [{ categoryId: food.id, amount: -100 }]);
			await TransactionTagRepository.setTags(filed.id, [tag.id]);

			// What "Confirm all categorized" does for an entry it never loaded: no splits, no tags.
			await TransactionEngine.confirmTransaction(key, filed.id);

			const [split] = await TransactionRepository.getSplits(key, filed.id);
			expect(split.categoryId).toBe(food.id);
			expect(await TransactionTagRepository.getTagIds(filed.id)).toEqual([tag.id]);
			expect((await TransactionRepository.getById(key, filed.id))?.reviewStatus).toBe('confirmed');
			expect(await TransactionRepository.countUnreviewed()).toBe(0);
		});

		it('leaves the still-uncategorized entries waiting', async () => {
			const food = await CategoryRepository.create(key, { name: 'Food' });
			const filed = await queue('filed', '2026-03-01', {}, [{ categoryId: food.id, amount: -100 }]);
			const open = await queue('open', '2026-03-02');
			for (const id of await TransactionRepository.categorizedUnreviewedIds()) {
				await TransactionEngine.confirmTransaction(key, id);
			}
			const waiting = await TransactionRepository.listUnreviewed(key);
			expect(waiting.map((t) => t.id)).toEqual([open.id]);
			expect(waiting.map((t) => t.id)).not.toContain(filed.id);
		});
	});
});
