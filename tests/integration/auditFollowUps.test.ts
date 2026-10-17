import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import {
	ExpectedEventRepository,
	RecurringRepository
} from '../../src/data/dexie/recurringRepository';
import {
	GoalContributionRepository,
	SavingsGoalRepository
} from '../../src/data/dexie/savingsGoalRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { PersonLoanRepository, PersonRepository } from '../../src/data/dexie/personLoanRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { generateExpectedEvents } from '../../src/domain/recurring/recurringEngine';
import { categoryBreakdown } from '../../src/domain/analytics/analyticsEngine';
import { buildDataTemplate, importDataTemplate } from '../../src/data/io/templateService';
import { checkIntegrity, describeIntegrityIssue } from '../../src/data/io/integrityService';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

// The follow-ups to the second audit: each is a behaviour that used to be wrong or missing and is now
// pinned — what Analytics does with refunds, that a failed template import changes nothing, that
// finding the event an entry paid does not look at every event, that a loan is never half-written,
// and what "Check my data" can see.
describe('audit follow-ups', () => {
	let key: CryptoKey;
	let bank: string;
	let bank2: string;

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

	const makeAccount = (name: string, openingBalance = 1_000_000) =>
		AccountRepository.create(key, {
			name,
			type: 'bank',
			openingBalance,
			creditLimit: null,
			billingCycleDay: null
		}).then((a) => a.id);

	beforeEach(async () => {
		key = await freshInstall('482915');
		bank = await makeAccount('Checking');
		bank2 = await makeAccount('Savings');
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Analytics and refunds', () => {
		it('nets money coming back into a category against what was spent there, like Budgets do', async () => {
			const shopping = (await CategoryRepository.create(key, { name: 'Shopping' })).id;
			const refundsOnly = (await CategoryRepository.create(key, { name: 'Gift cards' })).id;
			const record = (amount: number, categoryId: string, type: 'expense' | 'income') =>
				TransactionEngine.recordTransaction(
					key,
					{ accountId: bank, date: '2026-03-10', amount, type },
					[{ categoryId, amount }]
				);
			await record(-5_000, shopping, 'expense');
			await record(2_000, shopping, 'income'); // a refund
			await record(1_000, refundsOnly, 'income'); // money in, nothing spent: not spending

			const breakdown = await categoryBreakdown(key, '2026-03-01', '2026-03-31');

			expect(breakdown).toEqual([{ categoryId: shopping, categoryName: 'Shopping', total: 3_000 }]);
		});

		it('never lets a salary hide uncategorized spending, because its money in is unlabelled', async () => {
			await TransactionEngine.recordTransaction(
				key,
				{ accountId: bank, date: '2026-03-01', amount: 100_000, type: 'income' },
				[]
			);
			await TransactionEngine.recordTransaction(
				key,
				{ accountId: bank, date: '2026-03-02', amount: -300, type: 'expense' },
				[]
			);

			const breakdown = await categoryBreakdown(key, '2026-03-01', '2026-03-31');

			expect(breakdown.map((item) => item.total)).toEqual([300]);
		});
	});

	describe('a data-template import that fails part-way', () => {
		it('changes nothing: the data is exactly as it was, and the error says so', async () => {
			// A file with an account, a category and two entries…
			const sourceAccount = await makeAccount('From file', 500_000);
			const sourceCategory = (await CategoryRepository.create(key, { name: 'Groceries' })).id;
			for (const day of ['05', '06']) {
				await TransactionEngine.recordTransaction(
					key,
					{ accountId: sourceAccount, date: `2026-03-${day}`, amount: -1_000, type: 'expense' },
					[{ categoryId: sourceCategory, amount: -1_000 }]
				);
			}
			const template = JSON.parse(JSON.stringify(await buildDataTemplate(key)));

			// …imported into a different install that already holds some data of its own.
			key = await freshInstall('737373');
			const existing = await makeAccount('Existing', 250_000);
			await TransactionEngine.recordTransaction(
				key,
				{ accountId: existing, date: '2026-02-01', amount: -500, type: 'expense' },
				[]
			);
			const accountsBefore = await AccountRepository.list(key);
			const entriesBefore = await TransactionRepository.search(key);

			const original = TransactionEngine.recordTransaction.bind(TransactionEngine);
			let calls = 0;
			vi.spyOn(TransactionEngine, 'recordTransaction').mockImplementation(async (...args) => {
				calls += 1;
				if (calls === 2) throw new Error('disk full');
				return original(...args);
			});

			await expect(importDataTemplate(key, template)).rejects.toThrow(/nothing was changed/i);

			vi.restoreAllMocks();
			expect(await AccountRepository.list(key)).toEqual(accountsBefore);
			expect(await TransactionRepository.search(key)).toEqual(entriesBefore);
			expect(await CategoryRepository.list(key)).toHaveLength(0);
			// …and the same file imports cleanly afterwards, which a half-imported one could not.
			const result = await importDataTemplate(key, template);
			expect(result.perEntity.transactions.created).toBe(2);
		});
	});

	describe('finding the event an entry paid', () => {
		it('looks only at paid events due near the entry, not at every event', async () => {
			const rule = await RecurringRepository.create(key, {
				accountId: bank,
				categoryId: '__uncategorized__',
				amount: -20_000,
				frequency: 'monthly',
				dayOfPeriod: 5
			});
			await generateExpectedEvents(key, rule, new Date(2026, 5, 30), new Date(2026, 0, 1));
			for (const month of ['01', '02', '03', '04', '05']) {
				await TransactionEngine.recordTransaction(
					key,
					{ accountId: bank, date: `2026-${month}-05`, amount: -20_000, type: 'expense' },
					[]
				);
			}

			const near = await ExpectedEventRepository.listMatched(key, {
				dates: ['2026-03-05'],
				windowDays: 25
			});
			const everywhere = await ExpectedEventRepository.listMatched(key);

			expect(near.map((event) => event.expectedDate)).toEqual(['2026-03-05']);
			expect(everywhere).toHaveLength(5);
		});

		it('still frees the event when the entry was moved to another date', async () => {
			const rule = await RecurringRepository.create(key, {
				accountId: bank,
				categoryId: '__uncategorized__',
				amount: -20_000,
				frequency: 'monthly',
				dayOfPeriod: 5
			});
			await generateExpectedEvents(key, rule, new Date(2026, 3, 30), new Date(2026, 2, 1));
			const paid = await TransactionEngine.recordTransaction(
				key,
				{ accountId: bank, date: '2026-03-05', amount: -20_000, type: 'expense' },
				[]
			);
			const matched = async () =>
				(await ExpectedEventRepository.listForRule(key, rule.id)).filter(
					(event) => event.matchedTransactionId === paid.id
				);
			expect(await matched()).toHaveLength(1);

			// Far from any due date, so nothing else claims it either.
			await TransactionEngine.editTransaction(key, paid.id, { date: '2026-03-20' });

			expect(await matched()).toHaveLength(0);
		});
	});

	describe('person loans', () => {
		async function person() {
			return PersonRepository.create(key, { name: 'Asha' });
		}

		it('takes the ledger movement back out when the loan record cannot be written', async () => {
			const asha = await person();
			vi.spyOn(db.personLoans, 'put').mockRejectedValueOnce(new Error('disk full'));

			await expect(
				PersonLoanRepository.create(key, {
					personId: asha.id,
					direction: 'lent',
					principalAmount: 10_000,
					date: '2026-03-01',
					dueDate: null,
					notes: null,
					accountId: bank
				})
			).rejects.toThrow('disk full');

			expect(await TransactionRepository.count()).toBe(0);
			expect((await AccountRepository.getById(key, bank))!.currentBalance).toBe(1_000_000);
		});

		it('can still remove a loan whose ledger movement is already gone', async () => {
			const asha = await person();
			const loan = await PersonLoanRepository.create(key, {
				personId: asha.id,
				direction: 'lent',
				principalAmount: 10_000,
				date: '2026-03-01',
				dueDate: null,
				notes: null,
				accountId: bank
			});
			// What an earlier removal that failed half-way leaves behind.
			await db.transactions.delete(loan.transactionId);

			await PersonLoanRepository.remove(key, loan.id);

			expect(await PersonLoanRepository.getById(key, loan.id)).toBeUndefined();
		});
	});

	describe('Check my data', () => {
		it('reports records that point at an account, goal or category that is gone', async () => {
			const food = (await CategoryRepository.create(key, { name: 'Food' })).id;
			const goal = await SavingsGoalRepository.create(key, {
				name: 'Trip',
				targetAmount: 100_000,
				targetDate: null
			});
			await GoalContributionRepository.create(key, {
				goalId: goal.id,
				amount: 1_000,
				date: '2026-03-01'
			});
			await RecurringRepository.create(key, {
				accountId: bank2,
				categoryId: food,
				amount: -999,
				frequency: 'monthly',
				dayOfPeriod: 3,
				label: 'Gym'
			});
			expect((await checkIntegrity(key)).issues).toEqual([]);

			// Removed behind the app's back, the way an old version's delete left things.
			await db.accounts.delete(bank2);
			await db.savingsGoals.delete(goal.id);
			await db.categories.delete(food);

			const report = await checkIntegrity(key);
			const texts = report.issues.map(describeIntegrityIssue);
			expect(texts).toEqual(
				expect.arrayContaining([
					'The recurring payment "Gym" refers to the account it is paid from, which no longer exists.',
					'The recurring payment "Gym" refers to its category, which no longer exists.',
					'A savings contribution refers to its goal, which no longer exists.'
				])
			);
		});
	});
});
