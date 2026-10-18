import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import { RecurringRepository } from '../../src/data/dexie/recurringRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import {
	canTrack,
	detectSubscriptions,
	excludeTracked,
	ruleFromDetected,
	toMonthlyCost,
	type DetectedSubscription
} from '../../src/domain/recurring/subscriptionDetectionEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import type { RecurringRule } from '../../src/domain/entities';

const DAY_MS = 24 * 60 * 60 * 1000;
const asOf = new Date('2026-09-19T00:00:00Z');
const isoDaysAgo = (days: number) =>
	new Date(asOf.getTime() - days * DAY_MS).toISOString().slice(0, 10);

function detected(overrides: Partial<DetectedSubscription> = {}): DetectedSubscription {
	return {
		merchantId: 'm1',
		merchantName: 'Netflix',
		cadence: 'monthly',
		averageAmountMinor: 49_900,
		lastAmountMinor: 49_900,
		accountId: 'acc1',
		categoryId: 'cat1',
		lastTransactionId: 'tx1',
		monthlyCostMinor: 49_900,
		lastChargedDate: '2026-09-05',
		chargeCount: 3,
		isLapsed: false,
		dismissed: false,
		...overrides
	};
}

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
	return {
		id: 'r1',
		accountId: 'acc1',
		categoryId: 'cat1',
		amount: -49_900,
		frequency: 'monthly',
		dayOfPeriod: 5,
		isActive: true,
		createdAt: 0,
		updatedAt: 0,
		...overrides
	};
}

describe('toMonthlyCost', () => {
	it('turns any rhythm into a per-month figure', () => {
		expect(toMonthlyCost(49_900, 'monthly')).toBe(49_900);
		expect(toMonthlyCost(120_000, 'yearly')).toBe(10_000);
		expect(toMonthlyCost(30_000, 'quarterly')).toBe(10_000);
		expect(toMonthlyCost(1_200, 'weekly')).toBe(5_200);
	});
});

describe('excludeTracked', () => {
	it('hides a charge a rule already stands for: same account, same rhythm, about the same amount', () => {
		expect(excludeTracked([detected()], [rule()])).toEqual([]);
		// Within the same 5% the detection allows.
		expect(excludeTracked([detected()], [rule({ amount: -50_900 })])).toEqual([]);
	});

	it('keeps it when the rule is another account, rhythm, amount or direction', () => {
		const found = [detected()];
		expect(excludeTracked(found, [rule({ accountId: 'acc2' })])).toHaveLength(1);
		expect(excludeTracked(found, [rule({ frequency: 'yearly' })])).toHaveLength(1);
		expect(excludeTracked(found, [rule({ amount: -90_000 })])).toHaveLength(1);
		expect(excludeTracked(found, [rule({ amount: 49_900 })])).toHaveLength(1);
	});

	it('never hides a quarterly charge: no rule can stand for it', () => {
		expect(
			excludeTracked([detected({ cadence: 'quarterly' })], [rule({ frequency: 'monthly' })])
		).toHaveLength(1);
	});
});

describe('ruleFromDetected', () => {
	it('builds a subscription rule on the account, category, latest amount and day of the last charge', () => {
		const found = detected({ lastAmountMinor: 51_000, lastChargedDate: '2026-09-05' });
		expect(canTrack(found)).toBe(true);
		if (!canTrack(found)) return;
		expect(ruleFromDetected(found)).toEqual({
			accountId: 'acc1',
			categoryId: 'cat1',
			amount: -51_000,
			frequency: 'monthly',
			dayOfPeriod: 5,
			label: 'Netflix',
			isSubscription: true
		});
	});

	it('puts a yearly subscription on the month and day of its last charge', () => {
		const found = detected({
			cadence: 'yearly',
			lastAmountMinor: 120_000,
			lastChargedDate: '2026-03-01'
		});
		if (!canTrack(found)) throw new Error('a yearly charge can be tracked');
		expect(ruleFromDetected(found)).toMatchObject({
			frequency: 'yearly',
			dayOfPeriod: 1,
			monthOfYear: 3
		});
	});

	it('cannot track a quarterly charge', () => {
		expect(canTrack(detected({ cadence: 'quarterly' }))).toBe(false);
	});
});

describe('subscriptions detected from the database', () => {
	let key: CryptoKey;
	let accountId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('1313', randomSaltBase64());
		accountId = (
			await AccountRepository.create(key, {
				name: 'Card',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: 100_000,
				billingCycleDay: 15
			})
		).id;
	});

	it('reports the account, category and latest charge so it can be tracked', async () => {
		const merchant = await MerchantRepository.create(key, 'Netflix');
		const category = await CategoryRepository.create(key, { name: 'Entertainment' });
		for (const days of [90, 60, 30]) {
			await TransactionEngine.recordTransaction(
				key,
				{
					accountId,
					date: isoDaysAgo(days),
					amount: -49_900,
					type: 'expense',
					merchantId: merchant.id
				},
				[{ categoryId: category.id, amount: -49_900 }]
			);
		}
		const [found] = await detectSubscriptions(key, { asOf });
		expect(found).toMatchObject({
			accountId,
			categoryId: category.id,
			lastAmountMinor: 49_900,
			cadence: 'monthly'
		});
		expect(found.lastTransactionId).toBeTruthy();
	});

	it('groups captured card charges by the merchant read from the message, though they have no notes', async () => {
		// Filed before the parser could name the merchant: no merchantId, no notes, only the message.
		for (const days of [60, 30]) {
			await TransactionEngine.recordTransaction(key, {
				accountId,
				date: isoDaysAgo(days),
				amount: -64_900,
				type: 'expense',
				source: 'sms_capture',
				reviewStatus: 'unreviewed',
				capture: {
					channel: 'sms',
					sender: 'VM-ICICIB',
					receivedAt: Date.parse(isoDaysAgo(days)),
					text: 'Spent using ICICI Bank Card XX1234 on 12-Oct-26 on NETFLIX.COM. Avl Lmt INR 50,000.00'
				}
			});
		}
		const results = await detectSubscriptions(key, { asOf });
		expect(results).toHaveLength(1);
		expect(results[0]).toMatchObject({ cadence: 'monthly', averageAmountMinor: 64_900 });
		expect(results[0].merchantName.toLowerCase()).toContain('netflix');
	});

	it('does not mistake a captured credit card bill payment for a subscription', async () => {
		for (const days of [60, 30]) {
			await TransactionEngine.recordTransaction(key, {
				accountId,
				date: isoDaysAgo(days),
				amount: -500_000,
				type: 'expense',
				source: 'sms_capture',
				reviewStatus: 'unreviewed',
				capture: {
					channel: 'sms',
					sender: 'VM-HDFCBK',
					receivedAt: Date.parse(isoDaysAgo(days)),
					text: 'Rs.5,000.00 debited from A/c XX1234 towards your credit card XX5678 to CRED'
				}
			});
		}
		expect(await detectSubscriptions(key, { asOf })).toEqual([]);
	});
});

describe('RecurringRepository subscriptions', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('1414', randomSaltBase64());
	});

	it('stores the subscription flag only when set, and lists it back', async () => {
		const plain = await RecurringRepository.create(key, {
			accountId: 'a',
			categoryId: 'c',
			amount: -100,
			frequency: 'monthly',
			dayOfPeriod: 1
		});
		const sub = await RecurringRepository.create(key, {
			accountId: 'a',
			categoryId: 'c',
			amount: -200,
			frequency: 'monthly',
			dayOfPeriod: 2,
			label: 'Netflix',
			isSubscription: true
		});
		expect('isSubscription' in plain).toBe(false);
		const listed = await RecurringRepository.list(key);
		expect(listed.find((r) => r.id === sub.id)).toMatchObject({
			isSubscription: true,
			label: 'Netflix'
		});
		expect(listed.find((r) => r.id === plain.id)?.isSubscription).toBeUndefined();
	});
});
