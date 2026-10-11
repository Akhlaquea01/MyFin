import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import {
	RecurringRepository,
	ExpectedEventRepository
} from '../../src/data/dexie/recurringRepository';
import {
	TransactionRepository,
	UNCATEGORIZED_CATEGORY_ID
} from '../../src/data/dexie/transactionRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { markMissedPastDue } from '../../src/domain/recurring/recurringEngine';
import { importRows, type ColumnMapping } from '../../src/data/io/importService';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// A bill is usually PAID before it is categorized: it arrives as a bank-statement row, an SMS or a
// Quick Add paste with no category, and only gets one when it is confirmed in Review.
describe('recurring matching for bills that arrive uncategorized', () => {
	let key: CryptoKey;
	let accountId: string;
	let otherAccountId: string;
	let rentCategory: string;
	let otherCategory: string;
	let eventId: string;

	async function eventStatus() {
		const [event] = (await ExpectedEventRepository.listAll(key)).filter((e) => e.id === eventId);
		return event;
	}

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('6060', randomSaltBase64());
		const mk = (name: string) =>
			AccountRepository.create(key, {
				name,
				type: 'bank',
				openingBalance: 1_000_000,
				creditLimit: null,
				billingCycleDay: null
			});
		accountId = (await mk('Checking')).id;
		otherAccountId = (await mk('Savings')).id;
		rentCategory = (await CategoryRepository.create(key, { name: 'Rent' })).id;
		otherCategory = (await CategoryRepository.create(key, { name: 'Dining' })).id;

		const rule = await RecurringRepository.create(key, {
			accountId,
			categoryId: rentCategory,
			amount: -2_000_000,
			frequency: 'monthly',
			dayOfPeriod: 5
		});
		eventId = (
			await ExpectedEventRepository.create(key, {
				recurringRuleId: rule.id,
				expectedDate: '2026-03-05',
				status: 'pending',
				matchedTransactionId: null
			})
		).id;
	});

	const rent = (overrides: Record<string, unknown> = {}) => ({
		accountId,
		date: '2026-03-05',
		amount: -2_000_000,
		type: 'expense' as const,
		...overrides
	});

	it('matches an uncategorized entry (the way every import and Quick Add entry arrives)', async () => {
		const tx = await TransactionEngine.recordTransaction(key, rent({ source: 'quick_add' }));
		const event = await eventStatus();
		expect(event.status).toBe('matched');
		expect(event.matchedTransactionId).toBe(tx.id);
	});

	it('still refuses an entry with a different real category', async () => {
		await TransactionEngine.recordTransaction(key, rent(), [
			{ categoryId: otherCategory, amount: -2_000_000 }
		]);
		expect((await eventStatus()).status).toBe('pending');
	});

	it("still matches an entry with the rule's own category", async () => {
		await TransactionEngine.recordTransaction(key, rent(), [
			{ categoryId: rentCategory, amount: -2_000_000 }
		]);
		expect((await eventStatus()).status).toBe('matched');
	});

	it('does not match another account, a different amount, the opposite direction, or a date outside the window', async () => {
		await TransactionEngine.recordTransaction(key, rent({ accountId: otherAccountId }));
		await TransactionEngine.recordTransaction(key, rent({ amount: -1_999_999 }));
		await TransactionEngine.recordTransaction(key, rent({ amount: 2_000_000, type: 'income' }));
		await TransactionEngine.recordTransaction(key, rent({ date: '2026-03-10' }));
		expect((await eventStatus()).status).toBe('pending');
	});

	it('never matches a transfer, such as a person-loan movement of the same amount', async () => {
		await TransactionEngine.recordTransaction(key, rent({ type: 'transfer' }));
		expect((await eventStatus()).status).toBe('pending');
	});

	it('overturns a "missed" verdict when the bill is recorded late', async () => {
		await markMissedPastDue(key, new Date('2026-03-20T00:00:00Z'));
		expect((await eventStatus()).status).toBe('missed');

		// The February-style scenario: a statement imported after the due date has long passed.
		const tx = await TransactionEngine.recordTransaction(key, rent({ date: '2026-03-06' }));
		const event = await eventStatus();
		expect(event.status).toBe('matched');
		expect(event.matchedTransactionId).toBe(tx.id);
	});

	it('picks the closest due date when two expected events could match', async () => {
		const rule = (await RecurringRepository.list(key))[0];
		const nearer = await ExpectedEventRepository.create(key, {
			recurringRuleId: rule.id,
			expectedDate: '2026-03-07',
			status: 'pending',
			matchedTransactionId: null
		});
		await TransactionEngine.recordTransaction(key, rent({ date: '2026-03-07' }));
		const all = await ExpectedEventRepository.listAll(key);
		expect(all.find((e) => e.id === nearer.id)?.status).toBe('matched');
		expect(all.find((e) => e.id === eventId)?.status).toBe('pending');
	});

	describe('a bill imported from a statement, then categorized in Review', () => {
		const mapping = (): ColumnMapping => ({
			dateColumn: 'Date',
			amountColumn: 'Amount',
			descriptionColumn: 'Description',
			accountId,
			dateFormat: 'YYYY-MM-DD',
			amountSignConvention: 'negative-is-expense'
		});

		it('is matched on import, and stays matched after being confirmed', async () => {
			await importRows(
				key,
				[{ Date: '2026-03-05', Amount: '-20000.00', Description: 'NEFT LANDLORD RENT 5521' }],
				mapping()
			);
			const imported = (await TransactionRepository.search(key, { accountId }))[0];
			expect((await eventStatus()).matchedTransactionId).toBe(imported.id);

			await TransactionEngine.confirmTransaction(key, imported.id, [
				{ categoryId: rentCategory, amount: imported.amount }
			]);
			const event = await eventStatus();
			expect(event.status).toBe('matched');
			expect(event.matchedTransactionId).toBe(imported.id);
		});

		it('is un-matched if Review files it under a different category', async () => {
			await importRows(
				key,
				[{ Date: '2026-03-05', Amount: '-20000.00', Description: 'NEFT SOMETHING 5521' }],
				mapping()
			);
			const imported = (await TransactionRepository.search(key, { accountId }))[0];
			expect((await eventStatus()).status).toBe('matched'); // uncategorized: provisional

			await TransactionEngine.confirmTransaction(key, imported.id, [
				{ categoryId: otherCategory, amount: imported.amount }
			]);
			// Freed again — and, its due date being long past, back to "missed" rather than "pending".
			const event = await eventStatus();
			expect(event.matchedTransactionId).toBeNull();
			expect(event.status).toBe('missed');
		});
	});

	describe('keeping the schedule honest when a matched payment changes', () => {
		it('deleting the matched payment frees the event — pending if upcoming, missed if past due', async () => {
			const tx = await TransactionEngine.recordTransaction(key, rent());
			expect((await eventStatus()).status).toBe('matched');

			await TransactionEngine.deleteTransaction(key, tx.id);
			// 2026-03-05 is in the past relative to today's real date.
			const freed = await eventStatus();
			expect(freed.matchedTransactionId).toBeNull();
			expect(freed.status).toBe('missed');
		});

		it('discarding an unreviewed entry (Review → Discard) releases it too', async () => {
			const tx = await TransactionEngine.recordTransaction(
				key,
				rent({ reviewStatus: 'unreviewed' })
			);
			await TransactionEngine.deleteTransaction(key, tx.id);
			expect((await eventStatus()).matchedTransactionId).toBeNull();
		});

		it('restoring it from Trash claims the event again', async () => {
			const tx = await TransactionEngine.recordTransaction(key, rent());
			await TransactionEngine.deleteTransaction(key, tx.id);
			await TransactionEngine.restoreTransaction(key, tx.id);
			const event = await eventStatus();
			expect(event.status).toBe('matched');
			expect(event.matchedTransactionId).toBe(tx.id);
		});

		it('editing the date out of the window releases it; editing it back matches again', async () => {
			const tx = await TransactionEngine.recordTransaction(key, rent());
			await TransactionEngine.editTransaction(key, tx.id, { date: '2026-04-20' });
			expect((await eventStatus()).matchedTransactionId).toBeNull();

			await TransactionEngine.editTransaction(key, tx.id, { date: '2026-03-04' });
			expect((await eventStatus()).matchedTransactionId).toBe(tx.id);
		});

		it('turning the entry into a transfer releases it', async () => {
			const tx = await TransactionEngine.recordTransaction(key, rent());
			await TransactionEngine.convertToTransfer(key, tx.id, { accountId: otherAccountId });
			expect((await eventStatus()).matchedTransactionId).toBeNull();
		});

		it('does nothing, and does not fail, when no recurring rules exist', async () => {
			for (const rule of await RecurringRepository.list(key)) {
				await RecurringRepository.update(key, rule.id, { isActive: false });
			}
			await db.recurringRules.clear();
			await db.expectedEvents.clear();
			const tx = await TransactionEngine.recordTransaction(key, rent());
			await expect(
				TransactionEngine.confirmTransaction(key, tx.id, [
					{ categoryId: UNCATEGORIZED_CATEGORY_ID, amount: tx.amount }
				])
			).resolves.toBeDefined();
			await expect(TransactionEngine.deleteTransaction(key, tx.id)).resolves.toBeUndefined();
		});
	});
});
