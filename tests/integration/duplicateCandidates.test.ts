import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import {
	duplicateReason,
	findDuplicateCandidates
} from '../../src/domain/transactions/duplicateCandidates';
import type { CaptureInfo, Transaction } from '../../src/domain/entities';
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

describe('findDuplicateCandidates across accounts and references', () => {
	let key: CryptoKey;
	let checking: string;
	let savings: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('3940', randomSaltBase64());
		const mk = (name: string) =>
			AccountRepository.create(key, {
				name,
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			});
		checking = (await mk('Checking')).id;
		savings = (await mk('Savings')).id;
	});

	const record = (overrides: Record<string, unknown> = {}) =>
		TransactionEngine.recordTransaction(key, {
			accountId: checking,
			date: '2026-03-10',
			amount: -25_000,
			type: 'expense',
			...overrides
		});
	const captured = (refNo: string | null) => ({
		channel: 'sms' as const,
		sender: 'VM-HDFCBK',
		receivedAt: 0,
		text: 'x',
		refNo
	});

	it('looks on every account when the account is null', async () => {
		const onSavings = await record({ accountId: savings });
		const found = await findDuplicateCandidates(key, {
			accountId: null,
			amount: -25_000,
			date: '2026-03-10'
		});
		expect(found.map((t) => t.id)).toEqual([onSavings.id]);
	});

	it('reaches five days for the same reference, but not for the same amount alone', async () => {
		const sameRef = await record({ date: '2026-03-14', capture: captured('R1') });
		await record({ date: '2026-03-14', capture: captured('R2') });
		const found = await findDuplicateCandidates(
			key,
			{ accountId: checking, amount: -25_000, date: '2026-03-10' },
			{ refNo: 'R1' }
		);
		expect(found.map((t) => t.id)).toEqual([sameRef.id]);
	});

	it('ranks the same reference first, then the same merchant', async () => {
		const merchant = await MerchantRepository.create(key, { name: 'Swiggy' });
		const other = await MerchantRepository.create(key, { name: 'Zomato' });
		const sameMerchant = await record({ merchantId: merchant.id });
		const sameRef = await record({
			date: '2026-03-09',
			merchantId: other.id,
			capture: captured('R1')
		});
		const plain = await record({ date: '2026-03-11' });
		const found = await findDuplicateCandidates(
			key,
			{ accountId: checking, amount: -25_000, date: '2026-03-10' },
			{ merchantId: merchant.id, refNo: 'R1' }
		);
		expect(found.map((t) => t.id)).toEqual([sameRef.id, sameMerchant.id, plain.id]);
	});
});

describe('findDuplicateCandidates — capture times', () => {
	let key: CryptoKey;
	let checking: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('4040', randomSaltBase64());
		checking = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
	});

	const T0 = Date.UTC(2026, 2, 10, 9, 0, 0);
	const MINUTE = 60 * 1000;
	const at = (receivedAt: number): CaptureInfo => ({
		channel: 'sms',
		sender: 'VM-HDFCBK',
		receivedAt,
		text: 'x'
	});
	const record = (capture: CaptureInfo | null, date = '2026-03-10') =>
		TransactionEngine.recordTransaction(key, {
			accountId: checking,
			date,
			amount: -25_000,
			type: 'expense',
			...(capture ? { capture } : {})
		});

	it('puts the entry captured at nearly the same moment first, ahead of a later or an older one', async () => {
		const hoursLater = await record(at(T0 + 5 * 60 * MINUTE));
		const sameMoment = await record(at(T0 + 2 * MINUTE));
		const byHand = await record(null);
		const found = await findDuplicateCandidates(
			key,
			{ accountId: checking, amount: -25_000, date: '2026-03-10' },
			{ capture: { receivedAt: T0 } }
		);
		expect(found[0].id).toBe(sameMoment.id);
		expect(found.map((t) => t.id).sort()).toEqual([hoursLater.id, sameMoment.id, byHand.id].sort());
	});

	it('compares the stated payment times when both messages state one', async () => {
		// Received hours apart (a delayed copy), but both say the payment was at 09:00.
		const delayed = await record({ ...at(T0 + 6 * 60 * MINUTE), txnAt: T0 });
		const unrelated = await record({ ...at(T0 + MINUTE), txnAt: T0 + 7 * 60 * MINUTE });
		const found = await findDuplicateCandidates(
			key,
			{ accountId: checking, amount: -25_000, date: '2026-03-10' },
			{ capture: { receivedAt: T0 + 6 * 60 * MINUTE + MINUTE, txnAt: T0 } }
		);
		expect(found.map((t) => t.id)).toEqual([delayed.id, unrelated.id]);
	});
});

describe('duplicateReason', () => {
	const tx = (overrides: Partial<Transaction>) =>
		({ merchantId: null, ...overrides }) as Transaction;
	const withRef = (refNo: string) =>
		({ channel: 'sms', sender: 's', receivedAt: 0, text: 'x', refNo }) as CaptureInfo;

	it('names the strongest tie first', () => {
		expect(
			duplicateReason(
				tx({ capture: withRef('R1') }),
				tx({ capture: withRef('R1'), merchantId: 'm' })
			)
		).toBe('same-reference');
		expect(duplicateReason(tx({ merchantId: 'm' }), tx({ merchantId: 'm' }))).toBe('same-merchant');
		expect(duplicateReason(tx({ merchantId: 'm' }), tx({ merchantId: 'n' }))).toBe('same-amount');
		expect(duplicateReason(tx({}), tx({}))).toBe('same-amount');
	});

	it('calls two alerts a few minutes apart the same time, ahead of a shared merchant', () => {
		const MINUTE = 60 * 1000;
		const at = (receivedAt: number) =>
			({ channel: 'sms', sender: 's', receivedAt, text: 'x' }) as CaptureInfo;
		expect(
			duplicateReason(
				tx({ capture: at(0), merchantId: 'm' }),
				tx({ capture: at(5 * MINUTE), merchantId: 'm' })
			)
		).toBe('same-time');
		expect(
			duplicateReason(
				tx({ capture: at(0), merchantId: 'm' }),
				tx({ capture: at(5 * 60 * MINUTE), merchantId: 'm' })
			)
		).toBe('same-merchant');
		// A reference number still outranks the clock.
		expect(
			duplicateReason(
				tx({ capture: { ...at(0), refNo: 'R1' } }),
				tx({ capture: { ...at(MINUTE), refNo: 'R1' } })
			)
		).toBe('same-reference');
	});
});
