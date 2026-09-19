import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { RecurringRepository } from '../../src/data/dexie/recurringRepository';
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
});
