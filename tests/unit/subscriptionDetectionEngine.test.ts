import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import { detectSubscriptions } from '../../src/domain/recurring/subscriptionDetectionEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(days: number, from: Date): string {
	return new Date(from.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

describe('Subscription detection engine', () => {
	let key: CryptoKey;
	let accountId: string;
	const asOf = new Date('2026-09-19T00:00:00Z');

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('1212', randomSaltBase64());
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
	});

	async function chargeMerchant(
		merchantId: string,
		amounts: number[],
		daysAgoList: number[]
	): Promise<void> {
		for (let i = 0; i < amounts.length; i++) {
			await TransactionRepository.create(
				key,
				{
					accountId,
					date: isoDaysAgo(daysAgoList[i], asOf),
					amount: -amounts[i],
					type: 'expense',
					merchantId
				},
				[]
			);
		}
	}

	it('detects a monthly-cadence merchant with at least two charges', async () => {
		const merchant = await MerchantRepository.create(key, 'Netflix');
		await chargeMerchant(merchant.id, [49900, 49900, 49900], [90, 60, 30]);

		const results = await detectSubscriptions(key, { asOf });

		expect(results).toHaveLength(1);
		expect(results[0].merchantId).toBe(merchant.id);
		expect(results[0].cadence).toBe('monthly');
		expect(results[0].monthlyCostMinor).toBe(49900);
		expect(results[0].chargeCount).toBe(3);
		expect(results[0].lastChargedDate).toBe(isoDaysAgo(30, asOf));
	});

	it('does not flag a merchant with only a single charge', async () => {
		const merchant = await MerchantRepository.create(key, 'One-off Store');
		await chargeMerchant(merchant.id, [10000], [10]);

		const results = await detectSubscriptions(key, { asOf });
		expect(results).toHaveLength(0);
	});

	it('tolerates small amount variance (e.g. taxes/FX) within the tolerance band', async () => {
		const merchant = await MerchantRepository.create(key, 'Variable Bill');
		// ~2% variance, within the default 5% tolerance
		await chargeMerchant(merchant.id, [10000, 10150, 9900], [90, 60, 30]);

		const results = await detectSubscriptions(key, { asOf });
		expect(results).toHaveLength(1);
		expect(results[0].cadence).toBe('monthly');
	});

	it('does not classify charges whose amount varies beyond tolerance as a subscription', async () => {
		const merchant = await MerchantRepository.create(key, 'Unrelated Repeats');
		await chargeMerchant(merchant.id, [10000, 25000, 10000], [90, 60, 30]);

		const results = await detectSubscriptions(key, { asOf });
		expect(results).toHaveLength(0);
	});

	it('does not classify charges whose interval fits no recognized cadence bucket', async () => {
		const merchant = await MerchantRepository.create(key, 'Irregular Merchant');
		// ~17-day gaps fit no bucket (weekly ends at 10, monthly starts at 24)
		await chargeMerchant(merchant.id, [5000, 5000, 5000], [51, 34, 17]);

		const results = await detectSubscriptions(key, { asOf });
		expect(results).toHaveLength(0);
	});

	it('flags a subscription as lapsed once its last charge is past due for its cadence', async () => {
		const merchant = await MerchantRepository.create(key, 'Lapsed Gym');
		// Monthly cadence, but nothing charged in the last ~90 days
		await chargeMerchant(merchant.id, [200000, 200000, 200000], [150, 120, 90]);

		const results = await detectSubscriptions(key, { asOf });
		expect(results).toHaveLength(1);
		expect(results[0].isLapsed).toBe(true);
	});

	it('excludes a merchant the user has dismissed', async () => {
		const merchant = await MerchantRepository.create(key, 'Dismissed Service');
		await chargeMerchant(merchant.id, [30000, 30000], [60, 30]);
		await MerchantRepository.setSubscriptionDismissed(key, merchant.id, true);

		const results = await detectSubscriptions(key, { asOf });
		expect(results).toHaveLength(0);
	});

	it('is deterministic for identical inputs', async () => {
		const merchant = await MerchantRepository.create(key, 'Spotify');
		await chargeMerchant(merchant.id, [11900, 11900], [45, 15]);

		const first = await detectSubscriptions(key, { asOf });
		const second = await detectSubscriptions(key, { asOf });
		expect(first).toEqual(second);
	});
});
