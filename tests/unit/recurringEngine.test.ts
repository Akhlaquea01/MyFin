import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import {
	RecurringRepository,
	ExpectedEventRepository
} from '../../src/data/dexie/recurringRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import {
	generateExpectedEvents,
	markMissedPastDue
} from '../../src/domain/recurring/recurringEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('Recurring engine', () => {
	let key: CryptoKey;
	let accountId: string;
	let categoryId: string;

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
		const category = await CategoryRepository.create(key, { name: 'Rent' });
		categoryId = category.id;
	});

	it('generates an expected event ahead of a monthly rule’s due date', async () => {
		const rule = await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: -20000,
			frequency: 'monthly',
			dayOfPeriod: 15
		});

		const through = new Date('2026-04-01T00:00:00Z');
		const created = await generateExpectedEvents(
			key,
			rule,
			through,
			new Date('2026-03-01T00:00:00Z')
		);
		expect(created.length).toBeGreaterThan(0);
		expect(created.every((e) => e.status === 'pending')).toBe(true);
	});

	it('does not create duplicate events for the same date on repeated calls', async () => {
		const rule = await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: -20000,
			frequency: 'monthly',
			dayOfPeriod: 15
		});
		const through = new Date('2026-04-01T00:00:00Z');
		await generateExpectedEvents(key, rule, through, new Date('2026-03-01T00:00:00Z'));
		await generateExpectedEvents(key, rule, through, new Date('2026-03-01T00:00:00Z'));

		const events = await ExpectedEventRepository.listForRule(key, rule.id);
		const dates = events.map((e) => e.expectedDate);
		expect(new Set(dates).size).toBe(dates.length);
	});

	it('links a matching transaction to its expected event', async () => {
		const rule = await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: -20000,
			frequency: 'monthly',
			dayOfPeriod: 15
		});
		const through = new Date('2026-04-01T00:00:00Z');
		const [event] = await generateExpectedEvents(
			key,
			rule,
			through,
			new Date('2026-03-01T00:00:00Z')
		);

		await TransactionEngine.recordTransaction(
			key,
			{ accountId, date: event.expectedDate, amount: -20000, type: 'expense' },
			[{ categoryId, amount: -20000 }]
		);

		const events = await ExpectedEventRepository.listForRule(key, rule.id);
		const matched = events.find((e) => e.id === event.id);
		expect(matched?.status).toBe('matched');
		expect(matched?.matchedTransactionId).not.toBeNull();
	});

	it('flags an expected event as missed once its due date has passed unmatched', async () => {
		const rule = await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: -20000,
			frequency: 'monthly',
			dayOfPeriod: 5
		});
		const event = await ExpectedEventRepository.create(key, {
			recurringRuleId: rule.id,
			expectedDate: '2026-01-05',
			status: 'pending',
			matchedTransactionId: null
		});

		const missedCount = await markMissedPastDue(key, new Date('2026-01-10T00:00:00Z'));
		expect(missedCount).toBe(1);

		const events = await ExpectedEventRepository.listForRule(key, rule.id);
		expect(events.find((e) => e.id === event.id)?.status).toBe('missed');
	});
});
