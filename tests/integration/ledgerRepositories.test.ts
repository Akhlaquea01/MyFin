import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { TagRepository, TransactionTagRepository } from '../../src/data/dexie/tagRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Ledger repositories (Account, Category, Transaction) against Dexie', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('3333', randomSaltBase64());
	});

	it('prevents deleting an account that still has active transactions', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		await TransactionRepository.create(
			key,
			{ accountId: account.id, date: '2026-02-01', amount: -1000, type: 'expense' },
			[]
		);

		await expect(AccountRepository.softDelete(key, account.id)).rejects.toThrow(
			/active transactions/
		);
	});

	it('allows deleting an account once its transactions are soft-deleted', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		const tx = await TransactionRepository.create(
			key,
			{ accountId: account.id, date: '2026-02-01', amount: -1000, type: 'expense' },
			[]
		);
		await TransactionRepository.softDelete(key, tx.id);

		await expect(AccountRepository.softDelete(key, account.id)).resolves.not.toThrow();
		const deleted = await AccountRepository.getById(key, account.id);
		expect(deleted?.deletedAt).not.toBeNull();
	});

	it('splits a transaction across multiple categories summing to the total', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		const groceries = await CategoryRepository.create(key, { name: 'Groceries' });
		const household = await CategoryRepository.create(key, { name: 'Household' });

		const tx = await TransactionRepository.create(
			key,
			{ accountId: account.id, date: '2026-02-02', amount: -3000, type: 'expense' },
			[
				{ categoryId: groceries.id, amount: -2000 },
				{ categoryId: household.id, amount: -1000 }
			]
		);

		const splits = await TransactionRepository.getSplits(key, tx.id);
		expect(splits).toHaveLength(2);
		expect(splits.reduce((sum, s) => sum + s.amount, 0)).toBe(-3000);
	});

	it('searches transactions by account, date range, and free text', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		await TransactionRepository.create(
			key,
			{
				accountId: account.id,
				date: '2026-01-01',
				amount: -500,
				type: 'expense',
				notes: 'Coffee shop'
			},
			[]
		);
		await TransactionRepository.create(
			key,
			{
				accountId: account.id,
				date: '2026-06-01',
				amount: -1500,
				type: 'expense',
				notes: 'Groceries run'
			},
			[]
		);

		const byDateRange = await TransactionRepository.search(key, {
			accountId: account.id,
			dateFrom: '2026-05-01',
			dateTo: '2026-12-31'
		});
		expect(byDateRange).toHaveLength(1);
		expect(byDateRange[0].notes).toBe('Groceries run');

		const byText = await TransactionRepository.search(key, { freeText: 'coffee' });
		expect(byText).toHaveLength(1);
		expect(byText[0].notes).toBe('Coffee shop');
	});

	it('excludes soft-deleted transactions from search by default', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		const tx = await TransactionRepository.create(
			key,
			{ accountId: account.id, date: '2026-02-02', amount: -100, type: 'expense' },
			[]
		);
		await TransactionRepository.softDelete(key, tx.id);

		const results = await TransactionRepository.search(key, { accountId: account.id });
		expect(results).toHaveLength(0);

		const withDeleted = await TransactionRepository.search(key, {
			accountId: account.id,
			includeDeleted: true
		});
		expect(withDeleted).toHaveLength(1);
	});

	// spec 012: tag-based filtering & search
	describe('tag filtering and search', () => {
		async function createAccount() {
			return AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
		}

		it('filters by a single tag', async () => {
			const account = await createAccount();
			const reimbursable = await TagRepository.getOrCreate(key, 'reimbursable');
			const tagged = await TransactionRepository.create(
				key,
				{ accountId: account.id, date: '2026-02-01', amount: -500, type: 'expense' },
				[]
			);
			await TransactionTagRepository.setTags(tagged.id, [reimbursable.id]);
			await TransactionRepository.create(
				key,
				{ accountId: account.id, date: '2026-02-02', amount: -700, type: 'expense' },
				[]
			);

			const results = await TransactionRepository.search(key, { tagIds: [reimbursable.id] });
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(tagged.id);
		});

		it('composes the tag filter with an active account filter', async () => {
			const accountA = await createAccount();
			const accountB = await createAccount();
			const trip = await TagRepository.getOrCreate(key, 'trip:japan');
			const txA = await TransactionRepository.create(
				key,
				{ accountId: accountA.id, date: '2026-02-01', amount: -500, type: 'expense' },
				[]
			);
			const txB = await TransactionRepository.create(
				key,
				{ accountId: accountB.id, date: '2026-02-01', amount: -900, type: 'expense' },
				[]
			);
			await TransactionTagRepository.setTags(txA.id, [trip.id]);
			await TransactionTagRepository.setTags(txB.id, [trip.id]);

			const results = await TransactionRepository.search(key, {
				accountId: accountA.id,
				tagIds: [trip.id]
			});
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(txA.id);
		});

		it('matches any of several selected tags (OR)', async () => {
			const account = await createAccount();
			const trip = await TagRepository.getOrCreate(key, 'trip:japan');
			const reimbursable = await TagRepository.getOrCreate(key, 'reimbursable');
			const tripOnly = await TransactionRepository.create(
				key,
				{ accountId: account.id, date: '2026-02-01', amount: -500, type: 'expense' },
				[]
			);
			const reimbursableOnly = await TransactionRepository.create(
				key,
				{ accountId: account.id, date: '2026-02-02', amount: -600, type: 'expense' },
				[]
			);
			const neither = await TransactionRepository.create(
				key,
				{ accountId: account.id, date: '2026-02-03', amount: -700, type: 'expense' },
				[]
			);
			await TransactionTagRepository.setTags(tripOnly.id, [trip.id]);
			await TransactionTagRepository.setTags(reimbursableOnly.id, [reimbursable.id]);
			void neither;

			const results = await TransactionRepository.search(key, {
				tagIds: [trip.id, reimbursable.id]
			});
			expect(results.map((r) => r.id).sort()).toEqual(
				[tripOnly.id, reimbursableOnly.id].sort()
			);
		});

		it('treats an empty/absent tagIds as no tag filter', async () => {
			const account = await createAccount();
			await TransactionRepository.create(
				key,
				{ accountId: account.id, date: '2026-02-01', amount: -500, type: 'expense' },
				[]
			);

			const withEmpty = await TransactionRepository.search(key, { tagIds: [] });
			const withUndefined = await TransactionRepository.search(key, {});
			expect(withEmpty).toHaveLength(1);
			expect(withUndefined).toHaveLength(1);
		});

		it('matches free text against a tag name when notes do not match', async () => {
			const account = await createAccount();
			const trip = await TagRepository.getOrCreate(key, 'trip:japan');
			const tx = await TransactionRepository.create(
				key,
				{
					accountId: account.id,
					date: '2026-02-01',
					amount: -500,
					type: 'expense',
					notes: 'Lunch'
				},
				[]
			);
			await TransactionTagRepository.setTags(tx.id, [trip.id]);

			const results = await TransactionRepository.search(key, { freeText: 'japan' });
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(tx.id);
		});

		it('matches free text case-insensitively against a partial tag name', async () => {
			const account = await createAccount();
			const trip = await TagRepository.getOrCreate(key, 'Trip:Japan');
			const tx = await TransactionRepository.create(
				key,
				{ accountId: account.id, date: '2026-02-01', amount: -500, type: 'expense' },
				[]
			);
			await TransactionTagRepository.setTags(tx.id, [trip.id]);

			const results = await TransactionRepository.search(key, { freeText: 'JAPAN' });
			expect(results).toHaveLength(1);
			expect(results[0].id).toBe(tx.id);
		});

		it('TagRepository.listInUse excludes a tag with zero live transactions', async () => {
			const account = await createAccount();
			const conference = await TagRepository.getOrCreate(key, 'conference');
			const tx = await TransactionRepository.create(
				key,
				{ accountId: account.id, date: '2026-02-01', amount: -500, type: 'expense' },
				[]
			);
			await TransactionTagRepository.setTags(tx.id, [conference.id]);

			expect((await TagRepository.listInUse(key)).map((t) => t.id)).toContain(conference.id);

			await TransactionRepository.softDelete(key, tx.id);

			expect((await TagRepository.listInUse(key)).map((t) => t.id)).not.toContain(
				conference.id
			);
		});

		it('TagRepository.listInUse returns an empty array when no tags exist', async () => {
			expect(await TagRepository.listInUse(key)).toEqual([]);
		});

		it('TagRepository.listInUse sorts case-insensitively by name', async () => {
			const account = await createAccount();
			const zebra = await TagRepository.getOrCreate(key, 'zebra');
			const apple = await TagRepository.getOrCreate(key, 'Apple');
			const tx = await TransactionRepository.create(
				key,
				{ accountId: account.id, date: '2026-02-01', amount: -500, type: 'expense' },
				[]
			);
			await TransactionTagRepository.setTags(tx.id, [zebra.id, apple.id]);

			const names = (await TagRepository.listInUse(key)).map((t) => t.name);
			expect(names).toEqual(['Apple', 'zebra']);
		});
	});
});
