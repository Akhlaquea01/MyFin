import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { SavedFilterViewRepository } from '../../src/data/dexie/savedFilterViewRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Transaction search by amount', () => {
	let key: CryptoKey;
	let accountId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('4444', randomSaltBase64());
		accountId = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
		for (const [date, amount] of [
			['2026-02-01', -5000],
			['2026-02-02', -25000],
			['2026-02-03', 25000],
			['2026-02-04', 100000]
		] as const) {
			await TransactionRepository.create(
				key,
				{ accountId, date, amount, type: amount < 0 ? 'expense' : 'income' },
				[]
			);
		}
	});

	const amounts = async (filter: Parameters<typeof TransactionRepository.search>[1]) =>
		(await TransactionRepository.search(key, filter)).map((t) => t.amount).sort((a, b) => a - b);

	it('keeps entries at or above the minimum, in either direction', async () => {
		expect(await amounts({ amountMin: 25000 })).toEqual([-25000, 25000, 100000]);
	});

	it('keeps entries at or below the maximum, in either direction', async () => {
		expect(await amounts({ amountMax: 25000 })).toEqual([-25000, -5000, 25000]);
	});

	it('combines both bounds', async () => {
		expect(await amounts({ amountMin: 10000, amountMax: 30000 })).toEqual([-25000, 25000]);
	});

	it('combines with the other filters', async () => {
		expect(await amounts({ amountMin: 10000, dateFrom: '2026-02-03' })).toEqual([25000, 100000]);
	});

	it('does not filter by amount when no bound is given', async () => {
		expect(await amounts({})).toHaveLength(4);
	});

	it('returns nothing when the range excludes every entry', async () => {
		expect(await amounts({ amountMin: 200000 })).toEqual([]);
	});
});

describe('Saved filter views and amount bounds', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('4444', randomSaltBase64());
	});

	it('keeps the bounds a view was saved with', async () => {
		const view = await SavedFilterViewRepository.create(key, {
			name: 'Big spends',
			accountId: null,
			dateFrom: null,
			dateTo: null,
			freeText: null,
			tagIds: [],
			amountMin: 500000,
			amountMax: null
		});
		const loaded = await SavedFilterViewRepository.getById(key, view.id);
		expect(loaded).toMatchObject({ amountMin: 500000, amountMax: null });
	});

	it('still reads a view saved before the amount filter existed', async () => {
		const view = await SavedFilterViewRepository.create(key, {
			name: 'Old view',
			accountId: null,
			dateFrom: null,
			dateTo: null,
			freeText: 'rent',
			tagIds: []
		});
		const loaded = await SavedFilterViewRepository.getById(key, view.id);
		expect(loaded?.amountMin ?? null).toBeNull();
		expect(loaded?.amountMax ?? null).toBeNull();
	});
});
