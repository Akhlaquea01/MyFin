import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import {
	ExpectedEventRepository,
	RecurringRepository
} from '../../src/data/dexie/recurringRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import {
	deleteRecurringRule,
	generateExpectedEvents,
	updateRecurringRule
} from '../../src/domain/recurring/recurringEngine';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// Editing a rule must keep what already happened and replace only the plan that changed; deleting
// one must not leave anything pointing at it.
describe('editing and deleting recurring rules', () => {
	let key: CryptoKey;
	let account: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('7272', randomSaltBase64());
		account = (
			await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 100_000,
				creditLimit: null,
				billingCycleDay: null
			})
		).id;
	});

	/** A monthly rule due on the 5th, with Jan–Jun 2026 events: Feb matched, Mar missed, rest pending. */
	async function monthlyRule(label?: string) {
		const rule = await RecurringRepository.create(key, {
			accountId: account,
			categoryId: '__uncategorized__',
			amount: -20_000,
			frequency: 'monthly',
			dayOfPeriod: 5,
			label
		});
		await generateExpectedEvents(key, rule, new Date('2026-06-30'), new Date('2026-01-01'));
		const events = await ExpectedEventRepository.listForRule(key, rule.id);
		const on = (date: string) => events.find((e) => e.expectedDate === date)!;
		const paid = await TransactionEngine.recordTransaction(key, {
			accountId: account,
			date: '2026-02-05',
			amount: -20_000,
			type: 'expense'
		});
		await ExpectedEventRepository.update(key, on('2026-02-05').id, {
			status: 'matched',
			matchedTransactionId: paid.id
		});
		await ExpectedEventRepository.update(key, on('2026-03-05').id, { status: 'missed' });
		return { rule, paid };
	}
	const statuses = async (ruleId: string) =>
		Object.fromEntries(
			(await ExpectedEventRepository.listForRule(key, ruleId)).map((e) => [
				e.expectedDate,
				e.status
			])
		);

	it('changing the amount, label or category keeps every reminder as it was', async () => {
		const { rule } = await monthlyRule();
		const before = await statuses(rule.id);

		const updated = await updateRecurringRule(key, rule.id, {
			amount: -25_000,
			label: 'Rent',
			categoryId: 'cat-x'
		});

		expect(updated).toMatchObject({ amount: -25_000, label: 'Rent', categoryId: 'cat-x' });
		expect(await statuses(rule.id)).toEqual(before);
	});

	it('changing when it recurs drops only the reminders still waiting, and keeps what already happened', async () => {
		const { rule, paid } = await monthlyRule();

		await updateRecurringRule(key, rule.id, { dayOfPeriod: 20 });

		const after = await statuses(rule.id);
		// The matched payment and the missed date describe the past and stay.
		expect(after).toEqual({ '2026-02-05': 'matched', '2026-03-05': 'missed' });
		const matched = (await ExpectedEventRepository.listForRule(key, rule.id)).find(
			(e) => e.status === 'matched'
		);
		expect(matched?.matchedTransactionId).toBe(paid.id);

		// The schedule fills in again on the new day the next time it is read.
		await generateExpectedEvents(
			key,
			(await RecurringRepository.list(key))[0],
			new Date('2026-06-30'),
			new Date('2026-04-01')
		);
		const regenerated = await statuses(rule.id);
		expect(regenerated['2026-04-20']).toBe('pending');
		expect(regenerated['2026-04-05']).toBeUndefined();
	});

	it('changing the frequency replaces the waiting reminders too', async () => {
		const { rule } = await monthlyRule();
		await updateRecurringRule(key, rule.id, { frequency: 'weekly', dayOfPeriod: 1 });
		const after = await statuses(rule.id);
		expect(Object.values(after).filter((s) => s === 'pending')).toHaveLength(0);
		expect(Object.keys(after)).toHaveLength(2);
	});

	it('leaves other rules alone and refuses a rule that no longer exists', async () => {
		const { rule } = await monthlyRule();
		const other = await monthlyRule('Other');
		await updateRecurringRule(key, rule.id, { dayOfPeriod: 20 });
		const otherStatuses = await statuses(other.rule.id);
		expect(Object.values(otherStatuses).filter((s) => s === 'pending')).toHaveLength(4);

		await expect(updateRecurringRule(key, 'gone', { amount: -1 })).rejects.toThrow(
			/no longer exists/
		);
	});

	it('pausing is still just a flag: no reminder is touched', async () => {
		const { rule } = await monthlyRule();
		const before = await statuses(rule.id);
		const paused = await updateRecurringRule(key, rule.id, { isActive: false });
		expect(paused.isActive).toBe(false);
		expect(await statuses(rule.id)).toEqual(before);
	});

	it('deleting a rule removes it and its reminders but leaves the ledger and other rules alone', async () => {
		const { rule, paid } = await monthlyRule();
		const other = await monthlyRule('Other');

		await deleteRecurringRule(key, rule.id);

		expect((await RecurringRepository.list(key)).map((r) => r.id)).toEqual([other.rule.id]);
		expect(await ExpectedEventRepository.listForRule(key, rule.id)).toEqual([]);
		expect((await ExpectedEventRepository.listForRule(key, other.rule.id)).length).toBeGreaterThan(
			0
		);
		// The payment the rule had matched is still in the ledger, and the balance is unchanged.
		expect(await TransactionRepository.getById(key, paid.id)).toBeTruthy();
		expect((await AccountRepository.getById(key, account))?.currentBalance).toBe(
			100_000 - 20_000 - 20_000
		);
	});

	it('entries that named the rule stop naming it: the source entry and a bill tag', async () => {
		const { rule } = await monthlyRule();
		const source = await TransactionEngine.recordTransaction(key, {
			accountId: account,
			date: '2026-04-05',
			amount: -20_000,
			type: 'expense'
		});
		await TransactionRepository.update(key, source.id, { recurringRuleId: rule.id });
		const tagged = await TransactionEngine.recordTransaction(key, {
			accountId: account,
			date: '2026-05-05',
			amount: -21_000,
			type: 'expense',
			purpose: { kind: 'bills', targetId: rule.id }
		});
		const untouched = await TransactionEngine.recordTransaction(key, {
			accountId: account,
			date: '2026-05-06',
			amount: -500,
			type: 'expense',
			purpose: { kind: 'bills', targetId: null }
		});

		await deleteRecurringRule(key, rule.id);

		expect((await TransactionRepository.getById(key, source.id))?.recurringRuleId).toBeNull();
		// The tag stays, the pointer to a rule that is gone does not.
		expect((await TransactionRepository.getById(key, tagged.id))?.purpose).toEqual({
			kind: 'bills',
			targetId: null
		});
		expect((await TransactionRepository.getById(key, untouched.id))?.purpose).toEqual({
			kind: 'bills',
			targetId: null
		});
	});

	it('deleting a rule that is already gone does nothing', async () => {
		await expect(deleteRecurringRule(key, 'gone')).resolves.toBeUndefined();
	});
});
