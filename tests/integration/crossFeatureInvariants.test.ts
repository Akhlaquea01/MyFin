import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/notify', () => ({
	getNotifyPermission: async () => 'denied',
	showNotification: async () => true
}));

import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import {
	ExpectedEventRepository,
	RecurringRepository
} from '../../src/data/dexie/recurringRepository';
import { NotificationInboxRepository } from '../../src/data/dexie/notificationInboxRepository';
import { BudgetItemRepository, BudgetRepository } from '../../src/data/dexie/budgetRepository';
import {
	GoalContributionRepository,
	SavingsGoalRepository
} from '../../src/data/dexie/savingsGoalRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import {
	InvestmentHoldingRepository,
	LiabilityRepository
} from '../../src/data/dexie/wealthRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { runNotificationCheck } from '../../src/domain/notifications/runNotificationCheck';
import {
	generateExpectedEvents,
	updateRecurringRule
} from '../../src/domain/recurring/recurringEngine';
import { ensureCurrentBudgetItem } from '../../src/domain/budgets/budgetEngine';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { deleteAccount } from '../../src/domain/accounts/accountDeletion';
import { buildDataTemplate, importDataTemplate } from '../../src/data/io/templateService';
import { purgeStaleSharedPayloads } from '../../src/lib/shareTarget';
import { detachPurposeTarget } from '../../src/domain/transactions/purposeEngine';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

// Things that span two features and so fall between their own tests: a paused bill versus the
// reminders, deleting an account versus everything that points at it, a closed month versus the
// next month's rollover, a transfer made out of an entry that already did something, and what a
// data-template round trip keeps.
describe('cross-feature invariants', () => {
	let key: CryptoKey;
	let bank: string;
	let bank2: string;
	let cat: string;

	async function freshInstall(pin: string): Promise<CryptoKey> {
		await db.delete();
		await db.open();
		const salt = randomSaltBase64();
		const k = await deriveEncryptionKey(pin, salt);
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin(pin, pinSalt),
			pinSalt,
			encryptionSalt: salt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
		return k;
	}

	beforeEach(async () => {
		key = await freshInstall('482915');
		const mk = (name: string) =>
			AccountRepository.create(key, {
				name,
				type: 'bank',
				openingBalance: 1_000_000,
				creditLimit: null,
				billingCycleDay: null
			}).then((a) => a.id);
		bank = await mk('Checking');
		bank2 = await mk('Savings');
		cat = (await CategoryRepository.create(key, { name: 'Rent' })).id;
	});

	const rentRule = (accountId = bank) =>
		RecurringRepository.create(key, {
			accountId,
			categoryId: cat,
			amount: -10_000,
			frequency: 'monthly',
			dayOfPeriod: 15
		});

	describe('a paused recurring rule', () => {
		it('stops raising reminders for the payments it had already scheduled', async () => {
			const rule = await rentRule();
			const asOf = new Date(2026, 5, 14);
			const through = new Date(asOf);
			through.setDate(through.getDate() + 60);
			await generateExpectedEvents(key, rule, through, asOf);

			await updateRecurringRule(key, rule.id, { isActive: false });
			await runNotificationCheck(key, asOf);

			expect(await NotificationInboxRepository.list(key)).toHaveLength(0);
			expect(
				(await ExpectedEventRepository.listForRule(key, rule.id)).filter(
					(e) => e.status === 'pending'
				)
			).toHaveLength(0);
		});

		it('is ignored for reminders even when old pending events were left behind by an older version', async () => {
			const rule = await rentRule();
			const asOf = new Date(2026, 5, 14);
			const through = new Date(asOf);
			through.setDate(through.getDate() + 60);
			await generateExpectedEvents(key, rule, through, asOf);
			// What the previous Pause button did: flip the flag and nothing else.
			await RecurringRepository.update(key, rule.id, { isActive: false });

			await runNotificationCheck(key, asOf);

			expect(await NotificationInboxRepository.list(key)).toHaveLength(0);
		});

		it('does not claim an entry that matches its amount and date', async () => {
			const rule = await rentRule();
			await generateExpectedEvents(key, rule, new Date(2026, 3, 30), new Date(2026, 2, 1));
			await RecurringRepository.update(key, rule.id, { isActive: false });

			const tx = await TransactionEngine.recordTransaction(
				key,
				{ accountId: bank, date: '2026-03-15', amount: -10_000, type: 'expense' },
				[{ categoryId: cat, amount: -10_000 }]
			);

			const events = await ExpectedEventRepository.listForRule(key, rule.id);
			expect(events.some((e) => e.matchedTransactionId === tx.id)).toBe(false);
		});

		it('gets its reminders back when it is resumed', async () => {
			const rule = await rentRule();
			await updateRecurringRule(key, rule.id, { isActive: false });
			await updateRecurringRule(key, rule.id, { isActive: true });
			const asOf = new Date(2026, 5, 14);
			await runNotificationCheck(key, asOf);
			expect((await NotificationInboxRepository.list(key)).length).toBeGreaterThan(0);
		});
	});

	describe('deleting an account', () => {
		it('is refused while a recurring payment is paid from it', async () => {
			await rentRule(bank2);
			await expect(deleteAccount(key, bank2)).rejects.toThrow(/recurring payments/i);
			expect(await AccountRepository.getById(key, bank2)).not.toBeNull();
		});

		it('hands a linked card liability back to net worth and forgets it as the capture default', async () => {
			const card = await AccountRepository.create(key, {
				name: 'Card',
				type: 'credit_card',
				openingBalance: 0,
				creditLimit: 100_000,
				billingCycleDay: null
			});
			const liability = await LiabilityRepository.create(key, {
				name: 'Card',
				type: 'credit_card',
				outstandingBalance: 50_000,
				emiAmount: null,
				emiDueDay: null,
				linkedAccountId: card.id
			});
			await UserProfileRepository.update({
				capture: { enabled: true, sms: true, notifications: true, defaultAccountId: card.id }
			});

			await deleteAccount(key, card.id);

			expect((await LiabilityRepository.getById(key, liability.id))!.linkedAccountId).toBeNull();
			expect((await UserProfileRepository.get())!.capture!.defaultAccountId).toBeNull();
		});

		it('still refuses an account that has transactions, and changes nothing', async () => {
			await TransactionEngine.recordTransaction(
				key,
				{ accountId: bank2, date: '2026-03-05', amount: -500, type: 'expense' },
				[]
			);
			await expect(deleteAccount(key, bank2)).rejects.toThrow(/transactions/i);
		});
	});

	describe('rollover into a new month', () => {
		it('counts spending recorded after the closed month was last looked at', async () => {
			const budget = await BudgetRepository.create(key, {
				categoryId: cat,
				periodType: 'monthly',
				amount: 10_000_00,
				rolloverEnabled: true,
				isSinkingFund: false
			});
			// June's item as it was last refreshed: nothing spent yet.
			await BudgetItemRepository.create(key, {
				budgetId: budget.id,
				periodStart: '2026-06-01',
				periodEnd: '2026-06-30',
				plannedAmount: 10_000_00,
				actualAmount: 0,
				rolloverInAmount: 0
			});
			// Money spent in June afterwards, without the Budgets page being opened.
			await TransactionEngine.recordTransaction(
				key,
				{ accountId: bank, date: '2026-06-20', amount: -9_000_00, type: 'expense' },
				[{ categoryId: cat, amount: -9_000_00 }]
			);

			const july = await ensureCurrentBudgetItem(key, budget, new Date(2026, 6, 1));

			expect(july.rolloverInAmount).toBe(1_000_00);
			expect(july.plannedAmount).toBe(11_000_00);
		});
	});

	describe('turning an existing entry into a transfer leg', () => {
		it('undoes the savings contribution the other entry had made, and drops its tag', async () => {
			const goal = await SavingsGoalRepository.create(key, {
				name: 'Trip',
				targetAmount: 100_000,
				targetDate: null
			});
			const income = await TransactionEngine.recordTransaction(
				key,
				{ accountId: bank2, date: '2026-03-05', amount: 20_000, type: 'income' },
				[]
			);
			const expense = await TransactionEngine.recordTransaction(
				key,
				{
					accountId: bank,
					date: '2026-03-05',
					amount: -20_000,
					type: 'expense',
					purpose: { kind: 'savings', targetId: goal.id }
				},
				[]
			);
			expect(await GoalContributionRepository.list(key)).toHaveLength(1);

			await TransactionEngine.convertToTransfer(key, income.id, { transactionId: expense.id });

			expect((await TransactionRepository.getById(key, expense.id))!.purpose ?? null).toBeNull();
			expect(await GoalContributionRepository.list(key)).toHaveLength(0);
		});

		it('frees the recurring payment the other entry had been matched to', async () => {
			const rule = await RecurringRepository.create(key, {
				accountId: bank,
				categoryId: '__uncategorized__',
				amount: -20_000,
				frequency: 'monthly',
				dayOfPeriod: 5
			});
			await generateExpectedEvents(key, rule, new Date(2026, 3, 30), new Date(2026, 2, 1));
			const income = await TransactionEngine.recordTransaction(
				key,
				{ accountId: bank2, date: '2026-03-05', amount: 20_000, type: 'income' },
				[]
			);
			const expense = await TransactionEngine.recordTransaction(
				key,
				{ accountId: bank, date: '2026-03-05', amount: -20_000, type: 'expense' },
				[]
			);
			const matched = () =>
				ExpectedEventRepository.listForRule(key, rule.id).then((events) =>
					events.some((e) => e.matchedTransactionId === expense.id)
				);
			expect(await matched()).toBe(true);

			await TransactionEngine.convertToTransfer(key, income.id, { transactionId: expense.id });

			expect(await matched()).toBe(false);
		});
	});

	describe('deleting what an entry was marked as going to', () => {
		it('leaves the entry editable instead of refusing every change with "no longer exists"', async () => {
			const goal = await SavingsGoalRepository.create(key, {
				name: 'Trip',
				targetAmount: 100_000,
				targetDate: null
			});
			const debt = await LiabilityRepository.create(key, {
				name: 'Loan',
				type: 'loan',
				outstandingBalance: 500_000,
				emiAmount: null,
				emiDueDay: null
			});
			const saved = await TransactionEngine.recordTransaction(
				key,
				{
					accountId: bank,
					date: '2026-03-05',
					amount: -20_000,
					type: 'expense',
					purpose: { kind: 'savings', targetId: goal.id }
				},
				[]
			);
			const paid = await TransactionEngine.recordTransaction(
				key,
				{
					accountId: bank,
					date: '2026-03-06',
					amount: -10_000,
					type: 'expense',
					purpose: { kind: 'debt', targetId: debt.id }
				},
				[]
			);
			await SavingsGoalRepository.remove(goal.id);
			await LiabilityRepository.remove(debt.id);
			await expect(
				TransactionEngine.editTransaction(key, saved.id, { amount: -25_000 }, [
					{ categoryId: '__uncategorized__', amount: -25_000 }
				])
			).rejects.toThrow(/no longer exists/);

			expect(await detachPurposeTarget(key, 'savings', goal.id)).toBe(1);
			expect(await detachPurposeTarget(key, 'debt', debt.id)).toBe(1);

			const edited = await TransactionEngine.editTransaction(key, saved.id, { amount: -25_000 }, [
				{ categoryId: '__uncategorized__', amount: -25_000 }
			]);
			expect(edited.amount).toBe(-25_000);
			// The tag stays — the money still went to a goal — it just no longer names the one that is gone.
			expect(edited.purpose).toEqual({ kind: 'savings', targetId: null });
			expect((await TransactionRepository.getById(key, paid.id))!.purpose).toEqual({
				kind: 'debt',
				targetId: null
			});
		});
	});

	describe('a data-template round trip', () => {
		it('keeps what the fields of an entity said, not just its name', async () => {
			const account = await AccountRepository.create(key, {
				name: 'Wallet',
				type: 'wallet',
				openingBalance: 0,
				creditLimit: null,
				billingCycleDay: null,
				lowBalanceThresholdMinor: 250_000
			});
			const rule = await RecurringRepository.create(key, {
				accountId: account.id,
				categoryId: cat,
				amount: -999,
				frequency: 'monthly',
				dayOfPeriod: 3,
				label: 'Old gym'
			});
			await RecurringRepository.update(key, rule.id, { isActive: false });
			await InvestmentHoldingRepository.create(key, {
				name: 'Index fund',
				type: 'mutual_fund',
				costBasis: 100_000,
				units: 12.5,
				avgPrice: 8_000
			});
			await BudgetRepository.create(key, {
				categoryId: cat,
				periodType: 'monthly',
				amount: 5_000,
				rolloverEnabled: true,
				isSinkingFund: false,
				rolloverMode: 'full'
			});
			const merchant = await MerchantRepository.create(key, 'Netflix');
			await MerchantRepository.setSubscriptionDismissed(key, merchant.id, true);

			const template = await buildDataTemplate(key);
			key = await freshInstall('737373');
			await importDataTemplate(key, JSON.parse(JSON.stringify(template)));

			const [wallet] = (await AccountRepository.list(key)).filter((a) => a.name === 'Wallet');
			expect(wallet.lowBalanceThresholdMinor).toBe(250_000);
			const [restoredRule] = await RecurringRepository.list(key);
			expect(restoredRule.label).toBe('Old gym');
			expect(restoredRule.isActive).toBe(false);
			const [holding] = await InvestmentHoldingRepository.list(key);
			expect(holding.units).toBe(12.5);
			expect(holding.avgPrice).toBe(8_000);
			const [budget] = await BudgetRepository.list(key);
			expect(budget.rolloverMode).toBe('full');
			const [restoredMerchant] = (await MerchantRepository.list(key)).filter(
				(m) => m.name === 'Netflix'
			);
			expect(restoredMerchant.subscriptionDismissed).toBe(true);
		});
	});

	describe('unclaimed shares', () => {
		it('are removed once they are a day old, even if no new share ever arrives', async () => {
			const store = new Map<string, unknown>();
			const now = Date.now();
			const day = 24 * 60 * 60 * 1000;
			const put = (path: string, body: unknown) => store.set(`https://app.test${path}`, body);
			put('/share-target-meta/old', { sharedText: 'Rs 500 debited', savedAt: now - 2 * day });
			put('/share-target-file/old', 'bytes');
			put('/share-target-meta/fresh', { sharedText: 'Rs 20 debited', savedAt: now - 1000 });
			const urlOf = (request: Request | string) =>
				typeof request === 'string' ? `https://app.test${request}` : request.url;
			const cache = {
				keys: async () => [...store.keys()].map((url) => new Request(url)),
				match: async (request: Request | string) => {
					const value = store.get(urlOf(request));
					return value === undefined ? undefined : new Response(JSON.stringify(value));
				},
				delete: async (request: Request | string) => store.delete(urlOf(request))
			};
			vi.stubGlobal('caches', { open: async () => cache });
			try {
				await purgeStaleSharedPayloads(now);
			} finally {
				vi.unstubAllGlobals();
			}
			expect([...store.keys()]).toEqual(['https://app.test/share-target-meta/fresh']);
		});
	});
});
