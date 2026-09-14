import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { MerchantRepository } from '../../src/data/dexie/merchantRepository';
import { TagRepository, TransactionTagRepository } from '../../src/data/dexie/tagRepository';
import {
	TransactionRepository,
	TransactionSplitRepository
} from '../../src/data/dexie/transactionRepository';
import { BudgetRepository, BudgetItemRepository } from '../../src/data/dexie/budgetRepository';
import {
	InvestmentHoldingRepository,
	LiabilityRepository
} from '../../src/data/dexie/wealthRepository';
import { AttachmentRepository } from '../../src/data/dexie/attachmentRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import {
	PersonRepository,
	PersonLoanRepository,
	LoanRepaymentRepository
} from '../../src/data/dexie/personLoanRepository';
import { SavedFilterViewRepository } from '../../src/data/dexie/savedFilterViewRepository';
import { MerchantCategorySignalRepository } from '../../src/data/dexie/merchantCategorySignalRepository';
import { NotificationPreferenceRepository } from '../../src/data/dexie/notificationRepository';
import { DebtPlannerPreferenceRepository } from '../../src/data/dexie/debtPlannerPreferenceRepository';
import { importDataTemplate } from '../../src/data/io/templateService';
import type { DataTemplate } from '../../src/data/io/templateTypes';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

describe('templateService - Fresh install import (User Story 2)', () => {
	const pin = '1234';
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		const encryptionSalt = randomSaltBase64();
		key = await deriveEncryptionKey(pin, encryptionSalt);
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin(pin, pinSalt),
			pinSalt,
			encryptionSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
	});

	it('imports a complete template on a fresh install and resolves all relationships and balances', async () => {
		const template: DataTemplate = {
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: new Date().toISOString(),
			entities: {
				accounts: [
					{
						id: 'old-acc-1',
						name: 'Checking Account',
						type: 'bank',
						openingBalance: 100000, // 1000.00
						currentBalance: 100000,
						creditLimit: null,
						billingCycleDay: null,
						isArchived: false,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				categories: [
					{
						id: 'old-cat-parent',
						name: 'Food & Drink',
						parentId: null,
						icon: 'utensils',
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					},
					{
						id: 'old-cat-child',
						name: 'Groceries',
						parentId: 'old-cat-parent',
						icon: 'shopping-cart',
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				merchants: [
					{
						id: 'old-merch-1',
						name: 'Supermarket',
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				merchantAliases: [
					{
						id: 'old-alias-1',
						merchantId: 'old-merch-1',
						aliasText: 'SUPERMRKT #123',
						createdAt: 1000,
						updatedAt: 1000
					}
				],
				tags: [
					{
						id: 'old-tag-1',
						name: 'Essentials',
						createdAt: 1000,
						updatedAt: 1000
					}
				],
				investmentHoldings: [
					{
						id: 'old-inv-1',
						name: 'Index Fund',
						type: 'mutual_fund',
						costBasis: 50000,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				investmentValuations: [],
				liabilities: [],
				netWorthSnapshots: [],
				savingsGoals: [],
				goalContributions: [],
				budgets: [
					{
						id: 'old-budget-1',
						categoryId: 'old-cat-child',
						periodType: 'monthly',
						amount: 25000,
						rolloverEnabled: false,
						isSinkingFund: false,
						createdAt: 1000,
						updatedAt: 1000
					}
				],
				budgetItems: [],
				recurringRules: [],
				expectedEvents: [],
				categorizationRules: [],
				merchantCategorySignals: [],
				notificationPreference: null,
				debtPlannerPreference: null,
				transactions: [
					{
						id: 'old-tx-1',
						accountId: 'old-acc-1',
						date: '2026-09-10',
						amount: -4500, // -45.00 expense
						type: 'expense',
						transferPairId: null,
						merchantId: 'old-merch-1',
						notes: 'Weekly groceries',
						source: 'manual',
						reviewStatus: 'confirmed',
						duplicateOfId: null,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				transactionSplits: [
					{
						id: 'old-split-1',
						transactionId: 'old-tx-1',
						categoryId: 'old-cat-child',
						amount: -4500
					}
				],
				transactionTags: [
					{
						transactionId: 'old-tx-1',
						tagId: 'old-tag-1'
					}
				],
				attachments: [
					{
						id: 'old-att-1',
						transactionId: 'old-tx-1',
						mimeType: 'image/webp',
						data: 'base64sampledata',
						sizeBytes: 1024,
						createdAt: 1000,
						updatedAt: 1000
					}
				]
			}
		};

		const result = await importDataTemplate(key, template);

		expect(result.rejected).toBeUndefined();
		expect(result.perEntity.accounts?.created).toBe(1);
		expect(result.perEntity.categories?.created).toBe(2);
		expect(result.perEntity.transactions?.created).toBe(1);
		expect(result.perEntity.budgets?.created).toBe(1);
		expect(result.perEntity.attachments?.created).toBe(1);

		// Verify Account and Balance recalculation
		const accounts = await AccountRepository.list(key);
		expect(accounts.length).toBe(1);
		expect(accounts[0].name).toBe('Checking Account');
		expect(accounts[0].currentBalance).toBe(100000 - 4500); // 95500

		// Verify Category hierarchy resolution
		const categories = await CategoryRepository.list(key);
		expect(categories.length).toBe(2);
		const parent = categories.find((c) => c.name === 'Food & Drink')!;
		const child = categories.find((c) => c.name === 'Groceries')!;
		expect(child.parentId).toBe(parent.id);

		// Verify Budget links to the new category ID
		const budgets = await BudgetRepository.list(key);
		expect(budgets.length).toBe(1);
		expect(budgets[0].categoryId).toBe(child.id);

		// Verify Transaction, Split, Tag, and Attachment
		const txs = await TransactionRepository.search(key);
		expect(txs.length).toBe(1);
		expect(txs[0].accountId).toBe(accounts[0].id);

		const splits = await TransactionSplitRepository.listForTransaction(key, txs[0].id);
		expect(splits.length).toBe(1);
		expect(splits[0].categoryId).toBe(child.id);

		const tagIds = await TransactionTagRepository.getTagIds(txs[0].id);
		expect(tagIds.length).toBe(1);
		const tags = await TagRepository.list(key);
		expect(tagIds[0]).toBe(tags[0].id);

		const attachments = await AttachmentRepository.listForTransaction(key, txs[0].id);
		expect(attachments.length).toBe(1);
		expect(attachments[0].transactionId).toBe(txs[0].id);
	});

	it('gracefully skips records with unresolvable relationships without failing the import', async () => {
		const template: DataTemplate = {
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: new Date().toISOString(),
			entities: {
				accounts: [
					{
						id: 'old-acc-1',
						name: 'Savings',
						type: 'bank',
						openingBalance: 50000,
						currentBalance: 50000,
						creditLimit: null,
						billingCycleDay: null,
						isArchived: false,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				categories: [],
				merchants: [],
				merchantAliases: [],
				tags: [],
				investmentHoldings: [],
				investmentValuations: [],
				liabilities: [],
				netWorthSnapshots: [],
				savingsGoals: [],
				goalContributions: [],
				budgets: [
					{
						id: 'orphan-budget',
						categoryId: 'non-existent-category-id',
						periodType: 'monthly',
						amount: 10000,
						rolloverEnabled: false,
						isSinkingFund: false,
						createdAt: 1000,
						updatedAt: 1000
					}
				],
				budgetItems: [],
				recurringRules: [],
				expectedEvents: [],
				categorizationRules: [],
				merchantCategorySignals: [],
				notificationPreference: null,
				debtPlannerPreference: null,
				transactions: [],
				transactionSplits: [],
				transactionTags: [],
				attachments: []
			}
		};

		const result = await importDataTemplate(key, template);

		expect(result.perEntity.accounts?.created).toBe(1);
		expect(result.perEntity.budgets?.created ?? 0).toBe(0);
		expect(result.perEntity.budgets?.skipped).toBe(1);

		const skippedBudget = result.skippedReasons.find(
			(r) => r.entity === 'budgets' && r.reason === 'unresolved-relationship'
		);
		expect(skippedBudget).toBeDefined();

		const budgetsInDb = await BudgetRepository.list(key);
		expect(budgetsInDb.length).toBe(0);
	});

	// spec 016, FR-010/FR-018: reproduces the reported "budget not updating with json" bug —
	// an imported BudgetItem's actualAmount must never be trusted verbatim from the file, and a
	// legacy free-text investment type must be mapped onto the fixed InvestmentType dropdown.
	it('recomputes an imported budget item from the actual imported transactions instead of trusting the file', async () => {
		const template: DataTemplate = {
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: new Date().toISOString(),
			entities: {
				accounts: [
					{
						id: 'old-acc-1',
						name: 'Checking',
						type: 'bank',
						openingBalance: 0,
						currentBalance: 0,
						creditLimit: null,
						billingCycleDay: null,
						isArchived: false,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				categories: [
					{
						id: 'old-cat-1',
						name: 'Groceries',
						parentId: null,
						icon: null,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				merchants: [],
				merchantAliases: [],
				tags: [],
				investmentHoldings: [
					{
						id: 'old-inv-1',
						name: 'Coal India',
						type: 'Stock',
						costBasis: 100000,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				investmentValuations: [],
				liabilities: [],
				netWorthSnapshots: [],
				savingsGoals: [],
				goalContributions: [],
				budgets: [
					{
						id: 'old-budget-1',
						categoryId: 'old-cat-1',
						periodType: 'monthly',
						amount: 10000,
						rolloverEnabled: false,
						isSinkingFund: false,
						createdAt: 1000,
						updatedAt: 1000
					}
				],
				budgetItems: [
					{
						id: 'old-bi-1',
						budgetId: 'old-budget-1',
						periodStart: '2026-06-01',
						periodEnd: '2026-06-30',
						plannedAmount: 10000,
						// A stale/wrong snapshot value from the exporting device — must never survive
						// import verbatim.
						actualAmount: 999999,
						rolloverInAmount: 0,
						createdAt: 1000,
						updatedAt: 1000
					}
				],
				recurringRules: [],
				expectedEvents: [],
				categorizationRules: [],
				merchantCategorySignals: [],
				notificationPreference: null,
				debtPlannerPreference: null,
				transactions: [
					{
						id: 'old-tx-1',
						accountId: 'old-acc-1',
						date: '2026-06-10',
						amount: -3000,
						type: 'expense',
						transferPairId: null,
						merchantId: null,
						notes: 'Groceries',
						source: 'manual',
						reviewStatus: 'confirmed',
						duplicateOfId: null,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				transactionSplits: [
					{ id: 'old-split-1', transactionId: 'old-tx-1', categoryId: 'old-cat-1', amount: -3000 }
				],
				transactionTags: [],
				attachments: []
			}
		};

		const result = await importDataTemplate(key, template);
		expect(result.perEntity.budgetItems?.created).toBe(1);

		const budgets = await BudgetRepository.list(key);
		const budgetItems = await BudgetItemRepository.listForBudget(key, budgets[0].id);
		expect(budgetItems).toHaveLength(1);
		expect(budgetItems[0].actualAmount).toBe(3000);

		const holdings = await InvestmentHoldingRepository.list(key);
		expect(holdings[0].type).toBe('stock');
	});

	it('imports people, person loans, loan repayments, and singleton preferences on a fresh install', async () => {
		const template: DataTemplate = {
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: new Date().toISOString(),
			entities: {
				accounts: [
					{
						id: 'old-acc-1',
						name: 'Checking Account',
						type: 'bank',
						openingBalance: 100000,
						currentBalance: 100000,
						creditLimit: null,
						billingCycleDay: null,
						isArchived: false,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				categories: [],
				merchants: [],
				merchantAliases: [],
				tags: [],
				investmentHoldings: [],
				investmentValuations: [],
				liabilities: [],
				netWorthSnapshots: [],
				savingsGoals: [],
				goalContributions: [],
				budgets: [],
				budgetItems: [],
				recurringRules: [],
				expectedEvents: [],
				categorizationRules: [],
				merchantCategorySignals: [],
				notificationPreference: {
					id: 'local-user',
					enabled: false,
					reminderLeadDays: 5,
					budgetThresholdPercent: 90,
					permissionPromptDismissed: true,
					createdAt: 1000,
					updatedAt: 1000
				},
				debtPlannerPreference: {
					id: 'local-user',
					strategy: 'snowball',
					extraMonthlyPayment: 2500,
					createdAt: 1000,
					updatedAt: 1000
				},
				transactions: [
					{
						id: 'old-tx-loan',
						accountId: 'old-acc-1',
						date: '2026-09-01',
						amount: -20000,
						type: 'transfer',
						transferPairId: null,
						merchantId: null,
						notes: 'Lent to Alex',
						source: 'manual',
						reviewStatus: 'confirmed',
						duplicateOfId: null,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					},
					{
						id: 'old-tx-repayment',
						accountId: 'old-acc-1',
						date: '2026-09-15',
						amount: 5000,
						type: 'transfer',
						transferPairId: null,
						merchantId: null,
						notes: 'Repayment from Alex',
						source: 'manual',
						reviewStatus: 'confirmed',
						duplicateOfId: null,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				transactionSplits: [],
				transactionTags: [],
				attachments: [],
				people: [
					{
						id: 'old-person-1',
						name: 'Alex',
						notes: null,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				personLoans: [
					{
						id: 'old-loan-1',
						personId: 'old-person-1',
						direction: 'lent',
						principalAmount: 20000,
						date: '2026-09-01',
						dueDate: null,
						notes: null,
						accountId: 'old-acc-1',
						transactionId: 'old-tx-loan',
						writeOffAmount: 0,
						writeOffAt: null,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				loanRepayments: [
					{
						id: 'old-repayment-1',
						loanId: 'old-loan-1',
						amount: 5000,
						date: '2026-09-15',
						accountId: 'old-acc-1',
						transactionId: 'old-tx-repayment',
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				savedFilterViews: [
					{
						id: 'old-view-1',
						name: 'This month',
						accountId: 'old-acc-1',
						dateFrom: null,
						dateTo: null,
						freeText: null,
						tagIds: [],
						createdAt: 1000,
						updatedAt: 1000
					}
				]
			}
		};

		const result = await importDataTemplate(key, template);

		expect(result.rejected).toBeUndefined();
		expect(result.perEntity.people?.created).toBe(1);
		expect(result.perEntity.personLoans?.created).toBe(1);
		expect(result.perEntity.loanRepayments?.created).toBe(1);
		expect(result.perEntity.savedFilterViews?.created).toBe(1);
		expect(result.perEntity.notificationPreference?.created).toBe(1);
		expect(result.perEntity.debtPlannerPreference?.created).toBe(1);

		const people = await PersonRepository.list(key);
		expect(people).toHaveLength(1);
		expect(people[0].name).toBe('Alex');

		const loans = await PersonLoanRepository.listAllOpen(key);
		expect(loans).toHaveLength(1);
		expect(loans[0].personId).toBe(people[0].id);
		expect(loans[0].principalAmount).toBe(20000);

		const repayments = await LoanRepaymentRepository.listForLoan(key, loans[0].id);
		expect(repayments).toHaveLength(1);
		expect(repayments[0].amount).toBe(5000);

		// The loan/repayment must reuse the already-imported Transaction, not post a duplicate
		// movement — exactly two transactions should exist (loan + repayment), not four.
		const txs = await TransactionRepository.search(key);
		expect(txs).toHaveLength(2);
		expect(repayments[0].transactionId).not.toBe(loans[0].transactionId);
		expect(txs.map((t) => t.id).sort()).toEqual(
			[loans[0].transactionId, repayments[0].transactionId].sort()
		);

		const accounts = await AccountRepository.list(key);
		// 1000.00 opening - 200.00 lent + 50.00 repaid = 850.00
		expect(accounts[0].currentBalance).toBe(100000 - 20000 + 5000);

		const views = await SavedFilterViewRepository.list(key);
		expect(views).toHaveLength(1);
		expect(views[0].accountId).toBe(accounts[0].id);

		const notificationPref = await NotificationPreferenceRepository.get(key);
		expect(notificationPref.reminderLeadDays).toBe(5);
		expect(notificationPref.enabled).toBe(false);

		const debtPref = await DebtPlannerPreferenceRepository.get(key);
		expect(debtPref.strategy).toBe('snowball');
		expect(debtPref.extraMonthlyPayment).toBe(2500);
	});

	// spec 017: card identifier fields (Account) and duplicate-link fields (Liability) round-trip
	// through import, with linkedAccountId remapped from the file's old id to the newly-created
	// local Account id.
	it('imports card identifier and duplicate-link fields, remapping linkedAccountId', async () => {
		const template: DataTemplate = {
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: new Date().toISOString(),
			entities: {
				accounts: [
					{
						id: 'old-acc-1',
						name: 'HDFC Card',
						type: 'credit_card',
						openingBalance: 0,
						currentBalance: 0,
						creditLimit: 10000000,
						billingCycleDay: 5,
						cardLast4: '4321',
						cardNickname: 'Primary Card',
						isArchived: false,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				categories: [],
				merchants: [],
				merchantAliases: [],
				tags: [],
				investmentHoldings: [],
				investmentValuations: [],
				liabilities: [
					{
						id: 'old-liab-1',
						name: 'HDFC Card (manual)',
						type: 'credit_card',
						outstandingBalance: 5000,
						emiAmount: null,
						emiDueDay: null,
						interestRate: null,
						minimumPayment: null,
						linkedAccountId: 'old-acc-1',
						duplicateWarningDismissed: false,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				netWorthSnapshots: [],
				savingsGoals: [],
				goalContributions: [],
				budgets: [],
				budgetItems: [],
				recurringRules: [],
				expectedEvents: [],
				categorizationRules: [],
				merchantCategorySignals: [],
				notificationPreference: null,
				debtPlannerPreference: null,
				transactions: [],
				transactionSplits: [],
				transactionTags: [],
				attachments: []
			}
		};

		const result = await importDataTemplate(key, template);
		expect(result.perEntity.accounts?.created).toBe(1);
		expect(result.perEntity.liabilities?.created).toBe(1);

		const accounts = await AccountRepository.list(key);
		expect(accounts[0].cardLast4).toBe('4321');
		expect(accounts[0].cardNickname).toBe('Primary Card');

		const liabilities = await LiabilityRepository.list(key);
		expect(liabilities[0].linkedAccountId).toBe(accounts[0].id); // remapped, not the file's old id
		expect(liabilities[0].duplicateWarningDismissed).toBe(false);
	});

	it('reports a merged merchant category signal as updated, not created, on a second import', async () => {
		const baseTemplate: DataTemplate = {
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: new Date().toISOString(),
			entities: {
				accounts: [],
				categories: [
					{
						id: 'old-cat-1',
						name: 'Dining',
						parentId: null,
						icon: null,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				merchants: [
					{
						id: 'old-merch-1',
						name: 'Cafe Bloom',
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					}
				],
				merchantAliases: [],
				tags: [],
				investmentHoldings: [],
				investmentValuations: [],
				liabilities: [],
				netWorthSnapshots: [],
				savingsGoals: [],
				goalContributions: [],
				budgets: [],
				budgetItems: [],
				recurringRules: [],
				expectedEvents: [],
				categorizationRules: [],
				merchantCategorySignals: [
					{ id: 'old-merch-1', recentCategoryIds: ['old-cat-1'], createdAt: 1000, updatedAt: 1000 }
				],
				notificationPreference: null,
				debtPlannerPreference: null,
				transactions: [],
				transactionSplits: [],
				transactionTags: [],
				attachments: []
			}
		};

		const first = await importDataTemplate(key, baseTemplate);
		expect(first.perEntity.merchantCategorySignals?.created).toBe(1);
		expect(first.perEntity.merchantCategorySignals?.updated ?? 0).toBe(0);

		const second = await importDataTemplate(key, baseTemplate);
		expect(second.perEntity.merchantCategorySignals?.updated).toBe(1);
		expect(second.perEntity.merchantCategorySignals?.created ?? 0).toBe(0);

		const merchants = await MerchantRepository.list(key);
		const categories = await CategoryRepository.list(key);
		const signal = await MerchantCategorySignalRepository.get(key, merchants[0].id);
		// The same real category, resolved fresh both times (matched by name on the second
		// import, not recreated), appended to the rolling window rather than replacing it.
		expect(signal?.recentCategoryIds).toEqual([categories[0].id, categories[0].id]);
	});
});
