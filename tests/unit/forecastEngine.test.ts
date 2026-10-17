import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import {
	ExpectedEventRepository,
	RecurringRepository
} from '../../src/data/dexie/recurringRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { projectAccountBalance } from '../../src/domain/forecast/forecastEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Cash-flow forecast engine', () => {
	let key: CryptoKey;
	let accountId: string;
	let categoryId: string;
	const asOf = new Date('2026-09-19T00:00:00Z');

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('1212', randomSaltBase64());
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 500000,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
		await AccountRepository.setBalance(key, accountId, 500000);
		const category = await CategoryRepository.create(key, { name: 'Rent' });
		categoryId = category.id;
	});

	it('projects a warning when a scheduled expense will exceed the current balance', async () => {
		// A single ~90-day rule that clears the balance well within the 30-day horizon.
		await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: -600000,
			frequency: 'monthly',
			dayOfPeriod: new Date(asOf.getTime() + 10 * DAY_MS).getUTCDate()
		});

		const forecast = await projectAccountBalance(key, accountId, 30, asOf);

		expect(forecast.points).toHaveLength(30);
		expect(forecast.warning).not.toBeNull();
		expect(forecast.warning!.shortfallAmountMinor).toBeGreaterThan(0);
	});

	it('reports no warning when scheduled events keep the balance healthy', async () => {
		await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: -10000,
			frequency: 'monthly',
			dayOfPeriod: new Date(asOf.getTime() + 10 * DAY_MS).getUTCDate()
		});

		const forecast = await projectAccountBalance(key, accountId, 30, asOf);
		expect(forecast.warning).toBeNull();
	});

	it('respects a custom low-balance threshold', async () => {
		await AccountRepository.update(key, accountId, { lowBalanceThresholdMinor: 400000 });
		await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: -150000,
			frequency: 'monthly',
			dayOfPeriod: new Date(asOf.getTime() + 5 * DAY_MS).getUTCDate()
		});

		const forecast = await projectAccountBalance(key, accountId, 30, asOf);
		// Balance drops from 500000 to 350000, below the 400000 threshold, even though it never
		// goes negative.
		expect(forecast.warning).not.toBeNull();
	});

	it('does not count a payment twice: once as a past matched payment, once as the next scheduled one', async () => {
		const rule = await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: -20_000,
			frequency: 'monthly',
			dayOfPeriod: 25
		});
		// Three earlier months, each paid and matched to its reminder the way recording the payment does
		// (the entry itself carries no `recurringRuleId`; only the reminder points at it).
		for (const date of ['2026-06-25', '2026-07-25', '2026-08-25']) {
			const payment = await TransactionRepository.create(
				key,
				{ accountId, date, amount: -20_000, type: 'expense' },
				[]
			);
			await ExpectedEventRepository.create(key, {
				recurringRuleId: rule.id,
				expectedDate: date,
				status: 'matched',
				matchedTransactionId: payment.id
			});
		}

		const forecast = await projectAccountBalance(key, accountId, 30, asOf);

		// Only the 25 September payment is still to come. The three already-made ones must not also be
		// spread across the horizon as "everyday spending".
		expect(forecast.points[forecast.points.length - 1].projectedBalanceMinor).toBe(
			500_000 - 20_000
		);
	});

	it('marks low confidence for an account with no recurring rules and minimal history', async () => {
		const forecast = await projectAccountBalance(key, accountId, 30, asOf);
		expect(forecast.confidence).toBe('low');
	});

	it('marks normal confidence once enough recurring/historical signal exists', async () => {
		await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: -10000,
			frequency: 'monthly',
			dayOfPeriod: new Date(asOf.getTime() + 10 * DAY_MS).getUTCDate()
		});
		for (let i = 0; i < 10; i++) {
			await TransactionRepository.create(
				key,
				{
					accountId,
					date: new Date(asOf.getTime() - i * DAY_MS).toISOString().slice(0, 10),
					amount: -500,
					type: 'expense'
				},
				[]
			);
		}

		const forecast = await projectAccountBalance(key, accountId, 30, asOf);
		expect(forecast.confidence).toBe('normal');
	});

	it('is deterministic for identical inputs', async () => {
		await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: -10000,
			frequency: 'monthly',
			dayOfPeriod: new Date(asOf.getTime() + 10 * DAY_MS).getUTCDate()
		});

		const first = await projectAccountBalance(key, accountId, 30, asOf);
		const second = await projectAccountBalance(key, accountId, 30, asOf);
		expect(first.points).toEqual(second.points);
		expect(first.warning).toEqual(second.warning);
	});

	describe('credit cards', () => {
		const iso = (daysAgo: number) =>
			new Date(asOf.getTime() - daysAgo * DAY_MS).toISOString().slice(0, 10);

		async function makeCard(balance: number, creditLimit: number | null) {
			// A card's balance is negative by design: -90_000 means 900.00 is owed.
			const card = await AccountRepository.create(key, {
				name: 'Card',
				type: 'credit_card',
				openingBalance: balance,
				creditLimit,
				billingCycleDay: null
			});
			await AccountRepository.setBalance(key, card.id, balance);
			return card;
		}

		async function spend(accountId: string, amount: number, daysAgo: number) {
			await TransactionRepository.create(
				key,
				{ accountId, date: iso(daysAgo), amount: -amount, type: 'expense' },
				[]
			);
		}

		async function payBill(accountId: string, amount: number, daysAgo: number) {
			// The card side of a bill payment: a paired transfer leg arriving on the card.
			await TransactionRepository.create(
				key,
				{
					accountId,
					date: iso(daysAgo),
					amount,
					type: 'transfer',
					transferPairId: `bank-leg-${daysAgo}`
				},
				[]
			);
		}

		it('does not raise a low-balance warning just because the card carries debt', async () => {
			const card = await makeCard(-40_000, 500_000);
			const forecast = await projectAccountBalance(key, card.id, 30, asOf);
			expect(forecast.warning).toBeNull();
		});

		it('warns when the amount owed is projected to pass the credit limit, and says so', async () => {
			const card = await makeCard(-90_000, 100_000);
			for (let i = 0; i < 10; i++) await spend(card.id, 50_000, 5 + i * 8);

			const forecast = await projectAccountBalance(key, card.id, 30, asOf);
			expect(forecast.warning?.kind).toBe('over-limit');
			// How far OVER the limit, not how far below zero.
			const last = forecast.points[forecast.points.length - 1].projectedBalanceMinor;
			expect(last).toBeLessThan(-100_000);
			expect(forecast.warning!.shortfallAmountMinor).toBeGreaterThan(0);
		});

		it('counts the monthly bill payments, so a card that is paid off as it is used does not warn', async () => {
			const card = await makeCard(-90_000, 100_000);
			for (let i = 0; i < 10; i++) await spend(card.id, 50_000, 5 + i * 8);
			// The same total, paid back in three bill payments.
			await payBill(card.id, 200_000, 70);
			await payBill(card.id, 200_000, 40);
			await payBill(card.id, 100_000, 10);

			const forecast = await projectAccountBalance(key, card.id, 30, asOf);
			expect(forecast.warning).toBeNull();
		});

		it('never warns for a card with no credit limit set', async () => {
			const card = await makeCard(-90_000, null);
			for (let i = 0; i < 10; i++) await spend(card.id, 50_000, 5 + i * 8);
			const forecast = await projectAccountBalance(key, card.id, 30, asOf);
			expect(forecast.warning).toBeNull();
		});

		it('ordinary accounts still get a low-balance warning, and still ignore transfers in the drift', async () => {
			// Money moved to savings is not this account's spending drift.
			await TransactionRepository.create(
				key,
				{
					accountId,
					date: iso(10),
					amount: -400_000,
					type: 'transfer',
					transferPairId: 'savings-leg'
				},
				[]
			);
			await RecurringRepository.create(key, {
				accountId,
				categoryId,
				amount: -600_000,
				frequency: 'monthly',
				dayOfPeriod: new Date(asOf.getTime() + 10 * DAY_MS).getUTCDate()
			});
			const forecast = await projectAccountBalance(key, accountId, 30, asOf);
			expect(forecast.warning?.kind).toBe('low-balance');
			// Only the scheduled -600_000 moved the balance; the -400_000 transfer did not.
			expect(forecast.points[forecast.points.length - 1].projectedBalanceMinor).toBe(
				500_000 - 600_000
			);
		});
	});
});
