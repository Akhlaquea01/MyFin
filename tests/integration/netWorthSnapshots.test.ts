import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { NetWorthSnapshotRepository } from '../../src/data/dexie/wealthRepository';
import {
	computeNetWorth,
	ensureDailyNetWorthSnapshot,
	netWorthHistory,
	recordNetWorthSnapshot
} from '../../src/domain/wealth/wealthEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('net worth history', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('8686', randomSaltBase64());
	});

	const addAccount = (name: string, openingBalance: number) =>
		AccountRepository.create(key, {
			name,
			type: 'bank',
			openingBalance,
			creditLimit: null,
			billingCycleDay: null
		});

	describe('ensureDailyNetWorthSnapshot', () => {
		it('records the first look of each day, once', async () => {
			await addAccount('Checking', 100_000);

			const first = await ensureDailyNetWorthSnapshot(key, { date: '2026-03-01' });
			expect(first).toMatchObject({ date: '2026-03-01', netWorth: 100_000, totalAssets: 100_000 });
			expect(await ensureDailyNetWorthSnapshot(key, { date: '2026-03-01' })).toBeNull();
			expect(await netWorthHistory(key)).toHaveLength(1);

			const next = await ensureDailyNetWorthSnapshot(key, { date: '2026-03-02' });
			expect(next?.date).toBe('2026-03-02');
			expect((await netWorthHistory(key)).map((s) => s.date)).toEqual(['2026-03-01', '2026-03-02']);
		});

		it('never overwrites a point that is already there', async () => {
			const account = await addAccount('Checking', 100_000);
			await ensureDailyNetWorthSnapshot(key, { date: '2026-03-01' });
			await AccountRepository.setBalance(key, account.id, 250_000);

			expect(await ensureDailyNetWorthSnapshot(key, { date: '2026-03-01' })).toBeNull();
			expect((await netWorthHistory(key))[0].netWorth).toBe(100_000);
		});

		it('records nothing for a ledger with nothing in it', async () => {
			expect(await ensureDailyNetWorthSnapshot(key, { date: '2026-03-01' })).toBeNull();
			expect(await netWorthHistory(key)).toEqual([]);
		});

		it('uses a breakdown it is handed instead of computing its own', async () => {
			await addAccount('Checking', 100_000);
			const breakdown = await computeNetWorth(key);
			// The page has already worked these out; a stale-on-purpose copy proves they are the ones used.
			const snapshot = await ensureDailyNetWorthSnapshot(key, {
				date: '2026-03-01',
				breakdown: { ...breakdown, netWorth: 424_242 }
			});
			expect(snapshot?.netWorth).toBe(424_242);
		});
	});

	describe('recordNetWorthSnapshot', () => {
		it('refreshes the day’s point instead of adding a second one', async () => {
			const account = await addAccount('Checking', 100_000);
			const first = await recordNetWorthSnapshot(key, '2026-03-01');

			await AccountRepository.setBalance(key, account.id, 150_000);
			const second = await recordNetWorthSnapshot(key, '2026-03-01');

			expect(second.id).toBe(first.id);
			expect(second.createdAt).toBe(first.createdAt);
			const history = await netWorthHistory(key);
			expect(history).toHaveLength(1);
			expect(history[0].netWorth).toBe(150_000);
		});

		it('adds a point for a new day', async () => {
			await addAccount('Checking', 100_000);
			await recordNetWorthSnapshot(key, '2026-03-01');
			await recordNetWorthSnapshot(key, '2026-03-02');
			expect(await netWorthHistory(key)).toHaveLength(2);
		});
	});

	describe('NetWorthSnapshotRepository', () => {
		it('finds a day by the indexed date and lists the history oldest first', async () => {
			for (const date of ['2026-03-03', '2026-03-01', '2026-03-02']) {
				await NetWorthSnapshotRepository.create(key, {
					date,
					totalAssets: 1,
					totalLiabilities: 0,
					netWorth: 1
				});
			}
			expect((await NetWorthSnapshotRepository.findByDate(key, '2026-03-02'))?.date).toBe(
				'2026-03-02'
			);
			expect(await NetWorthSnapshotRepository.findByDate(key, '2026-04-01')).toBeNull();
			expect((await NetWorthSnapshotRepository.list(key)).map((s) => s.date)).toEqual([
				'2026-03-01',
				'2026-03-02',
				'2026-03-03'
			]);
		});

		it('lets the latest of several same-day points count, as older data may hold', async () => {
			await NetWorthSnapshotRepository.create(key, {
				date: '2026-03-01',
				totalAssets: 1,
				totalLiabilities: 0,
				netWorth: 111
			});
			await new Promise((resolve) => setTimeout(resolve, 5));
			await NetWorthSnapshotRepository.create(key, {
				date: '2026-03-01',
				totalAssets: 2,
				totalLiabilities: 0,
				netWorth: 222
			});
			expect((await NetWorthSnapshotRepository.findByDate(key, '2026-03-01'))?.netWorth).toBe(222);
		});
	});
});
