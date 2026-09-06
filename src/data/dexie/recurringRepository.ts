import { db, type RecurringRuleRow, type ExpectedEventRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import type { RecurringRule, ExpectedEvent, RecurringFrequency } from '../../domain/entities';

export interface NewRecurringRule {
	accountId: string;
	categoryId: string;
	amount: number;
	frequency: RecurringFrequency;
	dayOfPeriod: number;
}

export const RecurringRepository = {
	async create(key: CryptoKey, input: NewRecurringRule): Promise<RecurringRule> {
		const now = Date.now();
		const rule: RecurringRule = {
			id: crypto.randomUUID(),
			accountId: input.accountId,
			categoryId: input.categoryId,
			amount: input.amount,
			frequency: input.frequency,
			dayOfPeriod: input.dayOfPeriod,
			isActive: true,
			createdAt: now,
			updatedAt: now
		};
		await putEncrypted(db.recurringRules, key, rule, {
			accountId: rule.accountId,
			categoryId: rule.categoryId,
			isActive: 1
		});
		return rule;
	},

	async update(
		key: CryptoKey,
		id: string,
		changes: Partial<RecurringRule>
	): Promise<RecurringRule> {
		const existing = await getDecrypted<RecurringRuleRow, RecurringRule>(
			db.recurringRules,
			key,
			id
		);
		if (!existing) throw new Error(`RecurringRule ${id} not found`);
		const updated: RecurringRule = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.recurringRules, key, updated, {
			accountId: updated.accountId,
			categoryId: updated.categoryId,
			isActive: updated.isActive ? 1 : 0
		});
		return updated;
	},

	async list(key: CryptoKey): Promise<RecurringRule[]> {
		const rows = await db.recurringRules.toArray();
		return decryptRows<RecurringRuleRow, RecurringRule>(key, rows);
	},

	async listActive(key: CryptoKey): Promise<RecurringRule[]> {
		const rows = await db.recurringRules.where('isActive').equals(1).toArray();
		return decryptRows<RecurringRuleRow, RecurringRule>(key, rows);
	}
};

export const ExpectedEventRepository = {
	async create(
		key: CryptoKey,
		input: Omit<ExpectedEvent, 'id' | 'createdAt' | 'updatedAt'>
	): Promise<ExpectedEvent> {
		const now = Date.now();
		const event: ExpectedEvent = {
			id: crypto.randomUUID(),
			createdAt: now,
			updatedAt: now,
			...input
		};
		await putEncrypted(db.expectedEvents, key, event, {
			recurringRuleId: event.recurringRuleId,
			expectedDate: event.expectedDate,
			status: event.status
		});
		return event;
	},

	async update(
		key: CryptoKey,
		id: string,
		changes: Partial<ExpectedEvent>
	): Promise<ExpectedEvent> {
		const existing = await getDecrypted<ExpectedEventRow, ExpectedEvent>(
			db.expectedEvents,
			key,
			id
		);
		if (!existing) throw new Error(`ExpectedEvent ${id} not found`);
		const updated: ExpectedEvent = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.expectedEvents, key, updated, {
			recurringRuleId: updated.recurringRuleId,
			expectedDate: updated.expectedDate,
			status: updated.status
		});
		return updated;
	},

	async listForRule(key: CryptoKey, recurringRuleId: string): Promise<ExpectedEvent[]> {
		const rows = await db.expectedEvents.where('recurringRuleId').equals(recurringRuleId).toArray();
		const events = await decryptRows<ExpectedEventRow, ExpectedEvent>(key, rows);
		return events.sort((a, b) => (a.expectedDate < b.expectedDate ? 1 : -1));
	},

	async listAll(key: CryptoKey): Promise<ExpectedEvent[]> {
		const rows = await db.expectedEvents.toArray();
		const events = await decryptRows<ExpectedEventRow, ExpectedEvent>(key, rows);
		return events.sort((a, b) => (a.expectedDate < b.expectedDate ? -1 : 1));
	},

	async listPending(key: CryptoKey): Promise<ExpectedEvent[]> {
		const rows = await db.expectedEvents.where('status').equals('pending').toArray();
		const events = await decryptRows<ExpectedEventRow, ExpectedEvent>(key, rows);
		return events.sort((a, b) => (a.expectedDate < b.expectedDate ? -1 : 1));
	}
};
