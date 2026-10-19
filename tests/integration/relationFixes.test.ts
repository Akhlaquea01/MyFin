import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/lib/notify', () => ({
	getNotifyPermission: async () => 'denied',
	showNotification: async () => true
}));

import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { BudgetItemRepository, BudgetRepository } from '../../src/data/dexie/budgetRepository';
import {
	ExpectedEventRepository,
	RecurringRepository
} from '../../src/data/dexie/recurringRepository';
import { NotificationInboxRepository } from '../../src/data/dexie/notificationInboxRepository';
import { NotificationPreferenceRepository } from '../../src/data/dexie/notificationRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import {
	generateExpectedEvents,
	updateRecurringRule
} from '../../src/domain/recurring/recurringEngine';
import { runNotificationCheck } from '../../src/domain/notifications/runNotificationCheck';
import { setAccountArchived } from '../../src/domain/accounts/accountDeletion';
import { buildDataTemplate, importDataTemplate } from '../../src/data/io/templateService';
import { checkIntegrity } from '../../src/data/io/integrityService';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import {
	GoalContributionRepository,
	SavingsGoalRepository
} from '../../src/data/dexie/savingsGoalRepository';
import { PersonLoanRepository, PersonRepository } from '../../src/data/dexie/personLoanRepository';
import {
	InvestmentHoldingRepository,
	LiabilityRepository
} from '../../src/data/dexie/wealthRepository';
import {
	recordLiabilityPayment,
	recordPurchase,
	undoLatestTrade
} from '../../src/domain/wealth/wealthEngine';
import { removeGoalContribution } from '../../src/domain/transactions/purposeEngine';
import { createRuleFromTransaction } from '../../src/domain/recurring/recurringEngine';
import { detectSubscriptions } from '../../src/domain/recurring/subscriptionDetectionEngine';
import { ensureCurrentBudgetItem, updateBudget } from '../../src/domain/budgets/budgetEngine';
import { computeVarianceReport } from '../../src/domain/budgets/budgetVarianceEngine';
import { budgetPerformance } from '../../src/domain/analytics/analyticsEngine';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

// Gaps between features that the earlier audits' tests did not reach: a yearly budget in the monthly
// report, a budget whose period type is edited, a rollover that predates a back-filled month, and the
// other cross-entity links fixed alongside them.

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

const iso = (year: number, month: number, day: number) =>
	`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

describe('relation fixes', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		key = await freshInstall('482915');
	});

	const mkBank = (name: string, opening = 1_000_000) =>
		AccountRepository.create(key, {
			name,
			type: 'bank',
			openingBalance: opening,
			creditLimit: null,
			billingCycleDay: null
		});

	describe('budgets', () => {
		it('reports a yearly budget once per year, not once per month', async () => {
			const bank = await mkBank('Checking');
			const cat = await CategoryRepository.create(key, { name: 'Insurance' });
			await BudgetRepository.create(key, {
				categoryId: cat.id,
				periodType: 'yearly',
				amount: 1_200_000,
				rolloverEnabled: false,
				isSinkingFund: false
			});
			await TransactionEngine.recordTransaction(
				key,
				{ accountId: bank.id, date: '2026-11-15', amount: -600_000, type: 'expense' },
				[{ categoryId: cat.id, amount: -600_000 }]
			);

			const rows = (await computeVarianceReport(key, ['2026-11', '2026-12', '2027-01'])).filter(
				(r) => r.categoryId === cat.id
			);

			expect(rows.map((r) => r.month)).toEqual(['2026', '2027']);
			expect(rows[0]).toMatchObject({ budgetedMinor: 1_200_000, actualMinor: 600_000 });
			expect(rows[1]).toMatchObject({ budgetedMinor: 1_200_000, actualMinor: 0 });
		});

		it("drops a budget's old periods when its period type changes", async () => {
			const cat = await CategoryRepository.create(key, { name: 'Food' });
			const budget = await BudgetRepository.create(key, {
				categoryId: cat.id,
				periodType: 'monthly',
				amount: 100_000,
				rolloverEnabled: false,
				isSinkingFund: false
			});
			await ensureCurrentBudgetItem(key, budget, new Date(2026, 8, 10));

			const yearly = await updateBudget(key, budget.id, {
				periodType: 'yearly',
				amount: 1_200_000
			});
			await ensureCurrentBudgetItem(key, yearly, new Date(2026, 8, 10));

			const rows = await budgetPerformance(key, '2026-01-01', '2026-12-31');
			expect(rows.map((r) => [r.periodStart, r.periodEnd])).toEqual([['2026-01-01', '2026-12-31']]);
		});

		it('keeps the periods when only the amount changes', async () => {
			const cat = await CategoryRepository.create(key, { name: 'Food' });
			const budget = await BudgetRepository.create(key, {
				categoryId: cat.id,
				periodType: 'monthly',
				amount: 100_000,
				rolloverEnabled: false,
				isSinkingFund: false
			});
			await ensureCurrentBudgetItem(key, budget, new Date(2026, 8, 10));

			await updateBudget(key, budget.id, { amount: 150_000 });

			expect(await BudgetItemRepository.listForBudget(key, budget.id)).toHaveLength(1);
		});

		describe('rollover into the current month', () => {
			const now = new Date();
			const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
			const lastMonthDay = iso(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 15);

			async function rollingBudget(overrides = {}) {
				const cat = await CategoryRepository.create(key, { name: 'Food' });
				const budget = await BudgetRepository.create(key, {
					categoryId: cat.id,
					periodType: 'monthly',
					amount: 100_000,
					rolloverEnabled: true,
					isSinkingFund: false,
					...overrides
				});
				await ensureCurrentBudgetItem(key, budget, lastMonth);
				return { budget, cat };
			}

			async function spendLastMonth(categoryId: string, amount: number) {
				const bank = await mkBank('Checking');
				await TransactionEngine.recordTransaction(
					key,
					{ accountId: bank.id, date: lastMonthDay, amount: -amount, type: 'expense' },
					[{ categoryId, amount: -amount }]
				);
			}

			it('follows spending back-filled into last month after this month was opened', async () => {
				const { budget, cat } = await rollingBudget();
				const opened = await ensureCurrentBudgetItem(key, budget, now);
				expect(opened.rolloverInAmount).toBe(100_000);

				await spendLastMonth(cat.id, 80_000);
				const reopened = await ensureCurrentBudgetItem(key, budget, now);

				expect(reopened.rolloverInAmount).toBe(20_000);
				expect(reopened.plannedAmount).toBe(120_000);
			});

			it('keeps what had rolled in once rollover is switched off', async () => {
				const { budget, cat } = await rollingBudget();
				await ensureCurrentBudgetItem(key, budget, now);

				const off = await updateBudget(key, budget.id, {
					rolloverEnabled: false,
					rolloverMode: 'off'
				});
				await spendLastMonth(cat.id, 80_000);
				const reopened = await ensureCurrentBudgetItem(key, off, now);

				expect(reopened.rolloverInAmount).toBe(100_000);
			});
		});
	});

	describe('recurring payments and accounts', () => {
		const rentRule = (accountId: string, categoryId: string, overrides = {}) =>
			RecurringRepository.create(key, {
				accountId,
				categoryId,
				amount: -10_000,
				frequency: 'monthly',
				dayOfPeriod: new Date().getDate(),
				...overrides
			});

		describe('archiving an account', () => {
			it('is refused while an active recurring payment is paid from it', async () => {
				const bank = await mkBank('Old account', 0);
				const cat = await CategoryRepository.create(key, { name: 'Rent' });
				await rentRule(bank.id, cat.id);

				await expect(setAccountArchived(key, bank.id, true)).rejects.toThrow(
					/active recurring payment/
				);
				expect((await AccountRepository.getById(key, bank.id))?.isArchived).toBe(false);
			});

			it('goes ahead once the recurring payment is paused, and can be undone', async () => {
				const bank = await mkBank('Old account', 0);
				const cat = await CategoryRepository.create(key, { name: 'Rent' });
				const rule = await rentRule(bank.id, cat.id);
				await updateRecurringRule(key, rule.id, { isActive: false });

				await setAccountArchived(key, bank.id, true);
				expect((await AccountRepository.getById(key, bank.id))?.isArchived).toBe(true);

				await setAccountArchived(key, bank.id, false);
				expect((await AccountRepository.getById(key, bank.id))?.isArchived).toBe(false);
			});

			it('is still refused while the account holds money', async () => {
				const bank = await mkBank('Checking', 5_000);
				await expect(setAccountArchived(key, bank.id, true)).rejects.toThrow(/still has a balance/);
			});
		});

		describe('recurring alerts', () => {
			async function alertsFor(rules: { label?: string }[]) {
				const bank = await mkBank('Checking');
				const cat = await CategoryRepository.create(key, { name: 'Rent' });
				for (const rule of rules) await rentRule(bank.id, cat.id, rule);
				await NotificationPreferenceRepository.save(key, {
					id: 'local-user',
					enabled: true,
					reminderLeadDays: 3,
					budgetThresholdPercent: 90,
					permissionPromptDismissed: true,
					createdAt: 1,
					updatedAt: 1
				});
				await runNotificationCheck(key);
				return NotificationInboxRepository.list(key);
			}

			it('names the rule and what it pays, so two rules in one category differ', async () => {
				const alerts = await alertsFor([{ label: 'Flat rent', amount: -25_000 }, {}]);

				const titles = alerts.map((a) => a.title).sort();
				expect(titles).toEqual(['Upcoming: Flat rent', 'Upcoming: Rent']);
				const named = alerts.find((a) => a.title === 'Upcoming: Flat rent');
				expect(named?.body).toContain('250');
			});
		});

		describe('data-template import', () => {
			async function ruleWithPaidReminder() {
				const bank = await mkBank('Checking');
				const cat = await CategoryRepository.create(key, { name: 'Rent' });
				const rule = await rentRule(bank.id, cat.id);
				const asOf = new Date();
				const through = new Date(asOf);
				through.setDate(through.getDate() + 45);
				await generateExpectedEvents(key, rule, through, asOf);
				const [event] = await ExpectedEventRepository.listForRule(key, rule.id);
				const tx = await TransactionEngine.recordTransaction(
					key,
					{ accountId: bank.id, date: event.expectedDate, amount: -10_000, type: 'expense' },
					[{ categoryId: cat.id, amount: -10_000 }]
				);
				return { rule, event, tx };
			}

			it('does not leave a reminder marked paid when the entry that paid it is not imported', async () => {
				const { event } = await ruleWithPaidReminder();
				const template = await buildDataTemplate(key);
				// The importer skips an entry without a usable date.
				template.entities.transactions = template.entities.transactions.map((t) => ({
					...t,
					date: 'not-a-date'
				}));

				key = await freshInstall('111111');
				await importDataTemplate(key, template);

				const events = await ExpectedEventRepository.listAll(key);
				const restored = events.find((e) => e.expectedDate === event.expectedDate);
				expect(restored?.status).toBe('pending');
				expect(restored?.matchedTransactionId).toBeNull();
				expect((await checkIntegrity(key)).issues).toEqual([]);
			});

			it('still restores a paid reminder together with its entry', async () => {
				const { event } = await ruleWithPaidReminder();
				const template = await buildDataTemplate(key);

				key = await freshInstall('111111');
				await importDataTemplate(key, template);

				const restored = (await ExpectedEventRepository.listAll(key)).find(
					(e) => e.expectedDate === event.expectedDate
				);
				expect(restored?.status).toBe('matched');
				expect(restored?.matchedTransactionId).toBeTruthy();
				expect((await checkIntegrity(key)).issues).toEqual([]);
			});
		});

		it('"Check my data" reports a reminder marked paid that names no entry', async () => {
			const bank = await mkBank('Checking');
			const cat = await CategoryRepository.create(key, { name: 'Rent' });
			const rule = await rentRule(bank.id, cat.id);
			await ExpectedEventRepository.create(key, {
				recurringRuleId: rule.id,
				expectedDate: iso(2030, 1, 15),
				status: 'matched',
				matchedTransactionId: null
			});

			const { issues } = await checkIntegrity(key);

			expect(issues).toEqual([
				{
					kind: 'dangling-reference',
					owner: 'A recurring-payment reminder marked as paid',
					missing: 'the entry that paid it'
				}
			]);
		});
	});

	describe('entries that belong to a loan, a payment or a goal', () => {
		async function lentLoan(bankId: string, date = '2026-09-10') {
			const person = await PersonRepository.create(key, { name: 'Ravi', notes: null });
			return PersonLoanRepository.create(key, {
				personId: person.id,
				direction: 'lent',
				principalAmount: 500_000,
				date,
				dueDate: null,
				notes: null,
				accountId: bankId
			});
		}

		it('refuses to delete the money movement behind a loan, whichever page asks', async () => {
			const bank = await mkBank('Checking');
			const loan = await lentLoan(bank.id);

			await expect(TransactionEngine.deleteTransaction(key, loan.transactionId)).rejects.toThrow(
				/People page/
			);
			expect(await TransactionRepository.getById(key, loan.transactionId)).not.toBeNull();
		});

		it("still lets the loan's own page remove the loan together with its movement", async () => {
			const bank = await mkBank('Checking');
			const loan = await lentLoan(bank.id);

			await PersonLoanRepository.remove(key, loan.id);

			expect(await TransactionRepository.getById(key, loan.transactionId)).toBeNull();
			expect((await AccountRepository.getById(key, bank.id))?.currentBalance).toBe(1_000_000);
		});

		it('refuses to delete an investment purchase directly, but undoing the trade still removes the entry', async () => {
			const bank = await mkBank('Checking');
			const holding = await InvestmentHoldingRepository.create(key, {
				name: 'BEL',
				type: 'stock',
				costBasis: 0
			});
			const bought = await recordPurchase(key, holding.id, {
				units: 5,
				price: 10_000,
				date: '2026-09-05',
				accountId: bank.id
			});
			const trade = bought.trades![0];

			await expect(TransactionEngine.deleteTransaction(key, trade.transactionId!)).rejects.toThrow(
				/Investments page/
			);

			await undoLatestTrade(key, holding.id, trade.id);
			expect(await TransactionRepository.getById(key, trade.transactionId!)).toBeNull();
		});

		it("keeps a loan's movement when a data-template import files it for review and it is discarded", async () => {
			const bank = await mkBank('Checking');
			await lentLoan(bank.id);
			const template = await buildDataTemplate(key);

			// A bank-statement row of the same amount on the same day already sits on the account.
			key = await freshInstall('222222');
			const dest = await mkBank('Checking');
			await TransactionEngine.recordTransaction(key, {
				accountId: dest.id,
				date: '2026-09-10',
				amount: -500_000,
				type: 'expense',
				notes: 'UPI/RAVI'
			});
			await importDataTemplate(key, template);
			const [loan] = await PersonLoanRepository.listAllOpen(key);
			expect((await TransactionRepository.getById(key, loan.transactionId))?.reviewStatus).toBe(
				'unreviewed'
			);

			// What Discard does in the Review queue.
			await expect(TransactionEngine.deleteTransaction(key, loan.transactionId)).rejects.toThrow();

			expect((await checkIntegrity(key)).issues).toEqual([]);
		});

		describe('labelling one-sided transfers', () => {
			it('tells a loan movement from one that no record holds', async () => {
				const bank = await mkBank('Checking');
				const loan = await lentLoan(bank.id);
				const orphan = await TransactionEngine.recordTransaction(key, {
					accountId: bank.id,
					date: '2026-09-11',
					amount: -1_000,
					type: 'transfer',
					transferPairId: null,
					notes: 'Bought 5 units of BEL'
				});

				const kinds = await TransactionRepository.linkKindsByTransaction(key);

				expect(kinds.get(loan.transactionId)).toBe('loan');
				expect(kinds.has(orphan.id)).toBe(false);
			});
		});

		describe('removing a goal contribution', () => {
			async function savingsEntry() {
				const bank = await mkBank('Checking');
				const goal = await SavingsGoalRepository.create(key, {
					name: 'Trip',
					targetAmount: 1_000_000,
					targetDate: null
				});
				const tx = await TransactionEngine.recordTransaction(key, {
					accountId: bank.id,
					date: '2026-09-01',
					amount: -50_000,
					type: 'expense',
					purpose: { kind: 'savings', targetId: goal.id }
				});
				const [contribution] = await GoalContributionRepository.list(key);
				return { goal, tx, contribution };
			}

			it('takes the goal off the entry it came from, keeping its Savings tag', async () => {
				const { tx, contribution } = await savingsEntry();

				await removeGoalContribution(key, contribution.id);

				expect(await GoalContributionRepository.list(key)).toHaveLength(0);
				expect((await TransactionRepository.getById(key, tx.id))?.purpose).toEqual({
					kind: 'savings',
					targetId: null
				});
			});

			it('does not come back when the entry is edited later', async () => {
				const { tx, contribution } = await savingsEntry();
				await removeGoalContribution(key, contribution.id);

				await TransactionEngine.editTransaction(key, tx.id, { date: '2026-09-02' });

				expect(await GoalContributionRepository.list(key)).toHaveLength(0);
			});

			it('just removes a contribution that was logged directly on the goal', async () => {
				const goal = await SavingsGoalRepository.create(key, {
					name: 'Trip',
					targetAmount: 1_000_000,
					targetDate: null
				});
				const contribution = await GoalContributionRepository.create(key, {
					goalId: goal.id,
					amount: 10_000,
					date: '2026-09-01'
				});

				await removeGoalContribution(key, contribution.id);

				expect(await GoalContributionRepository.list(key)).toHaveLength(0);
			});
		});
	});

	describe('data-template round trip', () => {
		it('keeps the link between a recurring rule and the entry that created it', async () => {
			const bank = await mkBank('Checking');
			const cat = await CategoryRepository.create(key, { name: 'Rent' });
			const tx = await TransactionEngine.recordTransaction(
				key,
				{ accountId: bank.id, date: '2026-09-01', amount: -10_000, type: 'expense', notes: 'Rent' },
				[{ categoryId: cat.id, amount: -10_000 }]
			);
			await createRuleFromTransaction(key, tx, {
				frequency: 'monthly',
				dayOfPeriod: 1,
				categoryId: cat.id
			});
			const template = await buildDataTemplate(key);

			key = await freshInstall('333333');
			await importDataTemplate(key, template);

			const [rule] = await RecurringRepository.list(key);
			const [imported] = await TransactionRepository.search(key);
			expect(imported.recurringRuleId).toBe(rule.id);
		});
	});

	describe('subscription detection', () => {
		function monthsAgo(months: number): string {
			const now = new Date();
			const target = new Date(now.getFullYear(), now.getMonth() - months, 5);
			return iso(target.getFullYear(), target.getMonth() + 1, 5);
		}

		it('does not offer monthly loan EMI payments as a subscription', async () => {
			const bank = await mkBank('Checking', 100_000_000);
			const loan = await LiabilityRepository.create(key, {
				name: 'Home Loan',
				type: 'loan',
				outstandingBalance: 50_000_000,
				emiAmount: 2_500_000,
				emiDueDay: 5
			});
			for (const ago of [3, 2, 1]) {
				await recordLiabilityPayment(key, {
					liabilityId: loan.id,
					amount: 2_500_000,
					date: monthsAgo(ago),
					accountId: bank.id
				});
			}

			expect(await detectSubscriptions(key)).toEqual([]);
		});

		it('still detects an ordinary repeating charge', async () => {
			const bank = await mkBank('Checking', 100_000_000);
			for (const ago of [3, 2, 1]) {
				await TransactionEngine.recordTransaction(key, {
					accountId: bank.id,
					date: monthsAgo(ago),
					amount: -19_900,
					type: 'expense',
					notes: 'Netflix'
				});
			}

			const found = await detectSubscriptions(key);

			expect(found.map((f) => f.cadence)).toEqual(['monthly']);
		});
	});
});
