import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import {
	RecurringRepository,
	ExpectedEventRepository
} from '../../src/data/dexie/recurringRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('RecurringRepository + ExpectedEventRepository against Dexie', () => {
	let key: CryptoKey;
	let accountId: string;
	let categoryId: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('3434', randomSaltBase64());
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		accountId = account.id;
		const category = await CategoryRepository.create(key, { name: 'Salary' });
		categoryId = category.id;
	});

	it('creates, updates, and lists recurring rules, filtering active ones', async () => {
		const rule = await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: 50000,
			frequency: 'monthly',
			dayOfPeriod: 1
		});
		expect((await RecurringRepository.list(key)).map((r) => r.id)).toContain(rule.id);
		expect((await RecurringRepository.listActive(key)).map((r) => r.id)).toContain(rule.id);

		await RecurringRepository.update(key, rule.id, { isActive: false });
		expect((await RecurringRepository.listActive(key)).map((r) => r.id)).not.toContain(rule.id);
	});

	it('creates and lists expected events for a rule, sorted newest first', async () => {
		const rule = await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: 50000,
			frequency: 'monthly',
			dayOfPeriod: 1
		});
		await ExpectedEventRepository.create(key, {
			recurringRuleId: rule.id,
			expectedDate: '2026-01-01',
			status: 'pending',
			matchedTransactionId: null
		});
		await ExpectedEventRepository.create(key, {
			recurringRuleId: rule.id,
			expectedDate: '2026-02-01',
			status: 'pending',
			matchedTransactionId: null
		});

		const events = await ExpectedEventRepository.listForRule(key, rule.id);
		expect(events).toHaveLength(2);
		expect(events[0].expectedDate).toBe('2026-02-01');
	});

	it('lists only pending events across all rules', async () => {
		const rule = await RecurringRepository.create(key, {
			accountId,
			categoryId,
			amount: 50000,
			frequency: 'monthly',
			dayOfPeriod: 1
		});
		const pendingEvent = await ExpectedEventRepository.create(key, {
			recurringRuleId: rule.id,
			expectedDate: '2026-01-01',
			status: 'pending',
			matchedTransactionId: null
		});
		await ExpectedEventRepository.create(key, {
			recurringRuleId: rule.id,
			expectedDate: '2025-12-01',
			status: 'missed',
			matchedTransactionId: null
		});

		const pending = await ExpectedEventRepository.listPending(key);
		expect(pending.map((e) => e.id)).toEqual([pendingEvent.id]);
	});
});
