import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { findDuplicateCandidates } from '../../src/domain/transactions/duplicateCandidates';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// Pasting the same bank SMS twice (or an SMS for something already entered by hand) should be
// noticed — but only noticed: two same-amount purchases in a day can both be real.
describe('findDuplicateCandidates', () => {
	let key: CryptoKey;
	let accountId: string;
	let otherAccountId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('3939', randomSaltBase64());
		const mk = (name: string) =>
			AccountRepository.create(key, {
				name,
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
		accountId = (await mk('Checking')).id;
		otherAccountId = (await mk('Savings')).id;
	});

	const record = (overrides: Record<string, unknown> = {}) =>
		TransactionEngine.recordTransaction(key, {
			accountId,
			date: '2026-03-10',
			amount: -25_000,
			type: 'expense',
			...overrides
		});
	const query = (overrides: Record<string, unknown> = {}) => ({
		accountId,
		amount: -25_000,
		date: '2026-03-10',
		...overrides
	});

	it('finds the same amount on the same account within a day', async () => {
		const same = await record();
		const next = await record({ date: '2026-03-11' });
		const found = await findDuplicateCandidates(key, query());
		expect(found.map((t) => t.id).sort()).toEqual([same.id, next.id].sort());
	});

	it('ignores a different account, a different amount, the opposite direction, a far date, or a deleted entry', async () => {
		await record({ accountId: otherAccountId });
		await record({ amount: -25_001 });
		await record({ amount: 25_000, type: 'income' });
		await record({ date: '2026-03-13' });
		const deleted = await record();
		await TransactionEngine.deleteTransaction(key, deleted.id);
		expect(await findDuplicateCandidates(key, query())).toEqual([]);
	});

	it('includes entries still waiting in Review — the usual home of an earlier paste', async () => {
		const queued = await record({ source: 'quick_add', reviewStatus: 'unreviewed' });
		expect((await findDuplicateCandidates(key, query())).map((t) => t.id)).toEqual([queued.id]);
	});

	it('ranks the same merchant first, then the same date, then the most recent', async () => {
		const swiggy = await MerchantRepository.create(key, 'Swiggy');
		const zomato = await MerchantRepository.create(key, 'Zomato');
		const merchants = [swiggy, zomato];

		const otherMerchantSameDay = await record({ merchantId: zomato.id });
		const sameMerchantNextDay = await record({ merchantId: swiggy.id, date: '2026-03-11' });
		const noMerchantSameDay = await record();
		const noMerchantPrevDay = await record({ date: '2026-03-09' });

		// With a merchant to compare: Swiggy first, even though it is on a different day…
		const withMerchant = await findDuplicateCandidates(key, query(), {
			merchantName: ' swiggy ',
			merchants,
			limit: 10
		});
		expect(withMerchant[0].id).toBe(sameMerchantNextDay.id);
		// …then same-date entries ahead of the other-day one.
		const rest = withMerchant.slice(1).map((t) => t.id);
		expect(rest.indexOf(noMerchantPrevDay.id)).toBe(rest.length - 1);
		expect(new Set(rest)).toEqual(
			new Set([otherMerchantSameDay.id, noMerchantSameDay.id, noMerchantPrevDay.id])
		);

		// Without one, same-date entries still come before the neighbouring day's.
		const withoutMerchant = await findDuplicateCandidates(key, query(), { limit: 10 });
		expect(withoutMerchant.at(-1)!.date).not.toBe('2026-03-10');
	});

	it('returns at most `limit` matches (three by default)', async () => {
		for (let i = 0; i < 5; i++) await record();
		expect(await findDuplicateCandidates(key, query())).toHaveLength(3);
		expect(await findDuplicateCandidates(key, query(), { limit: 2 })).toHaveLength(2);
	});
});
