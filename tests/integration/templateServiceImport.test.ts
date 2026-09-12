import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TagRepository, TransactionTagRepository } from '../../src/data/dexie/tagRepository';
import { TransactionRepository, TransactionSplitRepository } from '../../src/data/dexie/transactionRepository';
import { BudgetRepository } from '../../src/data/dexie/budgetRepository';
import { InvestmentHoldingRepository } from '../../src/data/dexie/wealthRepository';
import { AttachmentRepository } from '../../src/data/dexie/attachmentRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
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
});
