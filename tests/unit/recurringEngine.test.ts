import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import {
	RecurringRepository,
	ExpectedEventRepository
} from '../../src/data/dexie/recurringRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import {
	createRuleFromTransaction,
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

	it('does not skip a year when a yearly rule is set to day 366 in a non-leap year', async () => {
		const rule = await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: -20000,
			frequency: 'yearly',
			dayOfPeriod: 366
		});

		// 2026 has no Feb 29 (not a leap year); asking from early 2026 through early 2028 must
		// still surface a 2026 occurrence (clamped to Dec 31) and a 2027 one, not skip 2026
		// entirely by rolling straight into 2027.
		const created = await generateExpectedEvents(
			key,
			rule,
			new Date('2028-01-15T00:00:00Z'),
			new Date('2026-01-01T00:00:00Z')
		);
		const dates = created.map((e) => e.expectedDate).sort();
		expect(dates).toContain('2026-12-31');
		expect(dates).toContain('2027-12-31');
	});

	it('does not match an income transaction against a same-magnitude expense recurring rule', async () => {
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

		// Same magnitude, opposite direction (e.g. a refund) must not satisfy the expense rule.
		await TransactionEngine.recordTransaction(
			key,
			{ accountId, date: event.expectedDate, amount: 20000, type: 'income' },
			[{ categoryId, amount: 20000 }]
		);

		const events = await ExpectedEventRepository.listForRule(key, rule.id);
		const stillPending = events.find((e) => e.id === event.id);
		expect(stillPending?.status).toBe('pending');
		expect(stillPending?.matchedTransactionId).toBeNull();
	});

	// spec 016, FR-005/FR-006: creating a recurring rule directly from a Review transaction.
	describe('createRuleFromTransaction (spec 016)', () => {
		it('creates a rule pre-filled from the transaction, with a label from its notes, and links it back', async () => {
			const tx = await TransactionEngine.recordTransaction(
				key,
				{ accountId, date: '2026-03-10', amount: -1500, notes: 'Netflix subscription', type: 'expense' },
				[{ categoryId, amount: -1500 }]
			);

			const rule = await createRuleFromTransaction(key, tx, {
				frequency: 'monthly',
				dayOfPeriod: 10
			});

			expect(rule.accountId).toBe(accountId);
			expect(rule.categoryId).toBe(categoryId);
			expect(rule.amount).toBe(-1500);
			expect(rule.frequency).toBe('monthly');
			expect(rule.dayOfPeriod).toBe(10);
			expect(rule.label).toBe('Netflix subscription');
			expect(rule.isActive).toBe(true);

			const updated = await TransactionRepository.getById(key, tx.id);
			expect(updated?.recurringRuleId).toBe(rule.id);
		});

		it('prefers an explicit categoryId override over the transaction’s persisted split', async () => {
			const otherCategory = await CategoryRepository.create(key, { name: 'Entertainment' });
			const tx = await TransactionEngine.recordTransaction(
				key,
				{ accountId, date: '2026-03-10', amount: -999, type: 'expense' },
				[{ categoryId, amount: -999 }]
			);

			const rule = await createRuleFromTransaction(key, tx, {
				frequency: 'weekly',
				dayOfPeriod: 2,
				categoryId: otherCategory.id
			});

			expect(rule.categoryId).toBe(otherCategory.id);
		});
	});
});
