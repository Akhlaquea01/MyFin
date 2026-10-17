import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { LiabilityRepository } from '../../src/data/dexie/wealthRepository';
import {
	GoalContributionRepository,
	SavingsGoalRepository
} from '../../src/data/dexie/savingsGoalRepository';
import {
	ExpectedEventRepository,
	RecurringRepository
} from '../../src/data/dexie/recurringRepository';
import { generateExpectedEvents } from '../../src/domain/recurring/recurringEngine';
import { purposeBreakdown } from '../../src/domain/analytics/analyticsEngine';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { recordLiabilityPayment, undoLiabilityPayment } from '../../src/domain/wealth/wealthEngine';
import { todayLocalISO } from '../../src/domain/shared/dateMath';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

// Marking an expense as debt, savings, investment or a bill is a tag on the entry AND a change to
// the thing it was for. These pin both halves, and that they stay in step as the entry is edited,
// confirmed, deleted or re-pointed.
describe('transaction purpose', () => {
	let key: CryptoKey;
	let bank: string;
	let card: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('5151', randomSaltBase64());
		const mk = (name: string, type: 'bank' | 'credit_card') =>
			AccountRepository.create(key, {
				name,
				type,
				openingBalance: 1_000_000,
				creditLimit: null,
				billingCycleDay: null
			}).then((a) => a.id);
		bank = await mk('Checking', 'bank');
		card = await mk('Card', 'credit_card');
	});

	const loan = () =>
		LiabilityRepository.create(key, {
			name: 'Car loan',
			type: 'loan',
			outstandingBalance: 500_000,
			emiAmount: 20_000,
			emiDueDay: 5
		});
	const expense = (overrides: Record<string, unknown> = {}) => ({
		accountId: bank,
		date: '2026-03-05',
		amount: -20_000,
		type: 'expense' as const,
		...overrides
	});
	const balanceOwed = async (id: string) => (await LiabilityRepository.getById(key, id))!;

	describe('debt', () => {
		it('lowers the balance owed and records the payment, which links the entry to the debt', async () => {
			const debt = await loan();
			let said: string | null = null;
			const tx = await TransactionEngine.recordTransaction(
				key,
				expense({ purpose: { kind: 'debt', targetId: debt.id } }),
				[],
				{ onPurposeEffect: (m) => (said = m) }
			);
			const after = await balanceOwed(debt.id);
			expect(after.outstandingBalance).toBe(480_000);
			expect(after.payments).toMatchObject([
				{ amount: 20_000, transactionId: tx.id, accountId: bank }
			]);
			expect(said).toContain('Car loan');
			expect(await TransactionRepository.getLoanLink(key, tx.id)).toEqual({
				kind: 'liability-payment',
				liabilityId: debt.id
			});
			expect((await TransactionRepository.getById(key, tx.id))?.purpose).toEqual({
				kind: 'debt',
				targetId: debt.id
			});
		});

		it('refuses a payment bigger than the balance, a credit-card source and a card tracked as an account, leaving nothing behind', async () => {
			const debt = await loan();
			const linked = await LiabilityRepository.create(key, {
				name: 'Card debt',
				type: 'credit_card',
				outstandingBalance: 100_000,
				emiAmount: null,
				emiDueDay: null,
				linkedAccountId: card
			});
			const before = (await TransactionRepository.search(key)).length;

			await expect(
				TransactionEngine.recordTransaction(
					key,
					expense({ amount: -600_000, purpose: { kind: 'debt', targetId: debt.id } })
				)
			).rejects.toThrow(/more than the .* still owed/);
			await expect(
				TransactionEngine.recordTransaction(
					key,
					expense({ accountId: card, purpose: { kind: 'debt', targetId: debt.id } })
				)
			).rejects.toThrow(/not from a credit card/);
			await expect(
				TransactionEngine.recordTransaction(
					key,
					expense({ purpose: { kind: 'debt', targetId: linked.id } })
				)
			).rejects.toThrow(/Pay bill/);

			expect((await TransactionRepository.search(key)).length).toBe(before);
			expect((await balanceOwed(debt.id)).outstandingBalance).toBe(500_000);
		});

		it('re-applies when the amount is edited, and puts the money back when the purpose is removed', async () => {
			const debt = await loan();
			const tx = await TransactionEngine.recordTransaction(
				key,
				expense({ purpose: { kind: 'debt', targetId: debt.id } })
			);
			await TransactionEngine.editTransaction(key, tx.id, { amount: -50_000 }, [
				{ categoryId: '__uncategorized__', amount: -50_000 }
			]);
			let owed = await balanceOwed(debt.id);
			expect(owed.outstandingBalance).toBe(450_000);
			expect(owed.payments).toHaveLength(1);

			await TransactionEngine.editTransaction(key, tx.id, { purpose: null });
			owed = await balanceOwed(debt.id);
			expect(owed.outstandingBalance).toBe(500_000);
			expect(owed.payments ?? []).toHaveLength(0);
		});

		it('moves the payment when the entry is pointed at another debt', async () => {
			const a = await loan();
			const b = await LiabilityRepository.create(key, {
				name: 'Phone EMI',
				type: 'loan',
				outstandingBalance: 90_000,
				emiAmount: null,
				emiDueDay: null
			});
			const tx = await TransactionEngine.recordTransaction(
				key,
				expense({ purpose: { kind: 'debt', targetId: a.id } })
			);
			await TransactionEngine.editTransaction(key, tx.id, {
				purpose: { kind: 'debt', targetId: b.id }
			});
			expect((await balanceOwed(a.id)).outstandingBalance).toBe(500_000);
			expect((await balanceOwed(b.id)).outstandingBalance).toBe(70_000);
		});

		it('gives the money back to the debt when the entry is deleted', async () => {
			const debt = await loan();
			const tx = await TransactionEngine.recordTransaction(
				key,
				expense({ purpose: { kind: 'debt', targetId: debt.id } })
			);
			await TransactionEngine.deleteTransaction(key, tx.id);
			const owed = await balanceOwed(debt.id);
			expect(owed.outstandingBalance).toBe(500_000);
			expect(owed.payments ?? []).toHaveLength(0);
		});

		it('waits for confirmation when the entry is still in Review, and refuses to confirm one that no longer fits', async () => {
			const debt = await loan();
			const tx = await TransactionEngine.recordTransaction(
				key,
				expense({
					reviewStatus: 'unreviewed',
					source: 'sms_capture',
					purpose: { kind: 'debt', targetId: debt.id }
				})
			);
			// Tagged, but nothing moved yet.
			expect((await balanceOwed(debt.id)).outstandingBalance).toBe(500_000);

			await LiabilityRepository.update(key, debt.id, { outstandingBalance: 5_000 });
			await expect(TransactionEngine.confirmTransaction(key, tx.id)).rejects.toThrow(
				/more than the .* still owed/
			);
			expect((await TransactionRepository.getById(key, tx.id))?.reviewStatus).toBe('unreviewed');

			await LiabilityRepository.update(key, debt.id, { outstandingBalance: 500_000 });
			let said: string | null = null;
			await TransactionEngine.confirmTransaction(key, tx.id, undefined, undefined, {
				onPurposeEffect: (m) => (said = m)
			});
			expect((await balanceOwed(debt.id)).outstandingBalance).toBe(480_000);
			expect(said).toContain('Car loan');
		});

		it('tags a payment made from the Liabilities page without moving the balance twice, and undo still works', async () => {
			const debt = await loan();
			const { payment } = await recordLiabilityPayment(key, {
				liabilityId: debt.id,
				amount: 20_000,
				date: '2026-03-05',
				accountId: bank
			});
			expect((await balanceOwed(debt.id)).outstandingBalance).toBe(480_000);
			const tx = await TransactionRepository.getById(key, payment.transactionId);
			expect(tx?.purpose).toEqual({ kind: 'debt', targetId: debt.id });

			await undoLiabilityPayment(key, debt.id, payment.id);
			expect((await balanceOwed(debt.id)).outstandingBalance).toBe(500_000);
			expect(await TransactionRepository.getById(key, payment.transactionId)).toBeFalsy();
		});

		it('keeps only the tag when told not to apply effects', async () => {
			const debt = await loan();
			await TransactionEngine.recordTransaction(
				key,
				expense({ purpose: { kind: 'debt', targetId: debt.id } }),
				[],
				{ skipPurposeEffects: true }
			);
			expect((await balanceOwed(debt.id)).outstandingBalance).toBe(500_000);
		});
	});

	describe('savings', () => {
		const goal = () =>
			SavingsGoalRepository.create(key, { name: 'Trip', targetAmount: 100_000, targetDate: null });

		it('adds a contribution that follows the entry when it is edited and deleted', async () => {
			const g = await goal();
			const date = todayLocalISO();
			const tx = await TransactionEngine.recordTransaction(
				key,
				expense({ date, amount: -10_000, purpose: { kind: 'savings', targetId: g.id } })
			);
			let contributions = await GoalContributionRepository.listForGoal(key, g.id);
			expect(contributions).toMatchObject([{ amount: 10_000, date, transactionId: tx.id }]);

			await TransactionEngine.editTransaction(key, tx.id, { amount: -15_000 }, [
				{ categoryId: '__uncategorized__', amount: -15_000 }
			]);
			contributions = await GoalContributionRepository.listForGoal(key, g.id);
			expect(contributions).toMatchObject([{ amount: 15_000 }]);
			expect(contributions).toHaveLength(1);

			await TransactionEngine.deleteTransaction(key, tx.id);
			expect(await GoalContributionRepository.listForGoal(key, g.id)).toHaveLength(0);
		});

		it('refuses a future date, and leaves no entry behind', async () => {
			const g = await goal();
			await expect(
				TransactionEngine.recordTransaction(
					key,
					expense({ date: '2999-01-01', purpose: { kind: 'savings', targetId: g.id } })
				)
			).rejects.toThrow(/future/);
			expect(await TransactionRepository.search(key)).toHaveLength(0);
		});
	});

	describe('bills', () => {
		async function rent() {
			const rule = await RecurringRepository.create(key, {
				accountId: bank,
				categoryId: '__uncategorized__',
				amount: -20_000,
				frequency: 'monthly',
				dayOfPeriod: 5
			});
			await generateExpectedEvents(key, rule, new Date('2026-06-30'), new Date('2026-01-01'));
			return rule;
		}
		const eventFor = async (ruleId: string, date: string) =>
			(await ExpectedEventRepository.listForRule(key, ruleId)).find(
				(e) => e.expectedDate === date
			)!;

		it('marks the named bill as paid, even when the amount is a little different', async () => {
			const rule = await rent();
			// Not the rule's amount, so the automatic matcher would never have taken it.
			const tx = await TransactionEngine.recordTransaction(
				key,
				expense({
					amount: -21_500,
					date: '2026-03-07',
					purpose: { kind: 'bills', targetId: rule.id }
				})
			);
			expect(await eventFor(rule.id, '2026-03-05')).toMatchObject({
				status: 'matched',
				matchedTransactionId: tx.id
			});
		});

		it('keeps the bill it was tied to when the entry is edited, and frees it on delete', async () => {
			const rule = await rent();
			const tx = await TransactionEngine.recordTransaction(
				key,
				expense({
					amount: -21_500,
					date: '2026-03-07',
					purpose: { kind: 'bills', targetId: rule.id }
				})
			);
			await TransactionEngine.editTransaction(key, tx.id, { notes: 'March rent' });
			expect(await eventFor(rule.id, '2026-03-05')).toMatchObject({ matchedTransactionId: tx.id });

			await TransactionEngine.deleteTransaction(key, tx.id);
			expect(await eventFor(rule.id, '2026-03-05')).toMatchObject({
				status: 'missed',
				matchedTransactionId: null
			});
		});

		it('only claims the bill once the entry is confirmed', async () => {
			const rule = await rent();
			const tx = await TransactionEngine.recordTransaction(
				key,
				expense({
					amount: -21_500,
					date: '2026-03-07',
					reviewStatus: 'unreviewed',
					purpose: { kind: 'bills', targetId: rule.id }
				})
			);
			expect(await eventFor(rule.id, '2026-03-05')).toMatchObject({ matchedTransactionId: null });
			await TransactionEngine.confirmTransaction(key, tx.id);
			expect(await eventFor(rule.id, '2026-03-05')).toMatchObject({ matchedTransactionId: tx.id });
		});

		it('says so when no payment of that bill is near the entry date', async () => {
			const rule = await rent();
			let said: string | null = null;
			await TransactionEngine.recordTransaction(
				key,
				expense({ date: '2026-09-15', purpose: { kind: 'bills', targetId: rule.id } }),
				[],
				{ onPurposeEffect: (m) => (said = m) }
			);
			expect(said).toMatch(/No upcoming payment/);
		});
	});

	describe('spending by purpose', () => {
		it('totals only marked spending in the range, largest first, and leaves other figures alone', async () => {
			const debt = await loan();
			await TransactionEngine.recordTransaction(
				key,
				expense({ amount: -20_000, purpose: { kind: 'debt', targetId: debt.id } })
			);
			await TransactionEngine.recordTransaction(
				key,
				expense({
					amount: -30_000,
					date: '2026-03-06',
					purpose: { kind: 'investment', targetId: null }
				})
			);
			await TransactionEngine.recordTransaction(
				key,
				expense({
					amount: -5_000,
					date: '2026-03-07',
					purpose: { kind: 'investment', targetId: null }
				})
			);
			// Unmarked spending, and marked spending outside the range, are not counted.
			await TransactionEngine.recordTransaction(key, expense({ amount: -99_000 }));
			await TransactionEngine.recordTransaction(
				key,
				expense({ amount: -7_000, date: '2025-01-01', purpose: { kind: 'bills', targetId: null } })
			);

			expect(await purposeBreakdown(key, '2026-03-01', '2026-03-31')).toEqual([
				{ kind: 'investment', total: 35_000, count: 2 },
				{ kind: 'debt', total: 20_000, count: 1 }
			]);
		});
	});

	describe('investment and the tag itself', () => {
		it('stores an investment tag without changing anything else', async () => {
			const tx = await TransactionEngine.recordTransaction(
				key,
				expense({ purpose: { kind: 'investment', targetId: null } })
			);
			expect((await TransactionRepository.getById(key, tx.id))?.purpose).toEqual({
				kind: 'investment',
				targetId: null
			});
		});

		it('only accepts spending: income cannot be marked, and editing to income drops the tag', async () => {
			await expect(
				TransactionEngine.recordTransaction(
					key,
					expense({ amount: 5_000, type: 'income', purpose: { kind: 'savings', targetId: null } })
				)
			).rejects.toThrow(/Only spending/);

			const tx = await TransactionEngine.recordTransaction(
				key,
				expense({ purpose: { kind: 'investment', targetId: null } })
			);
			const edited = await TransactionEngine.editTransaction(
				key,
				tx.id,
				{ type: 'income', amount: 20_000 },
				[{ categoryId: '__uncategorized__', amount: 20_000 }]
			);
			expect(edited.purpose).toBeNull();
		});

		it('leaves an entry with no purpose exactly as it was stored before the feature', async () => {
			const tx = await TransactionEngine.recordTransaction(key, expense());
			expect('purpose' in tx).toBe(false);
		});
	});
});
