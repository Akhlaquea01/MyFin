import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { AttachmentRepository } from '../../src/data/dexie/attachmentRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { TransactionEngine } from '../../src/domain/transactions/transactionEngine';
import { importDataTemplate } from '../../src/data/io/templateService';
import type { DataTemplate } from '../../src/data/io/templateTypes';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

describe('templateService - Overlapping import (User Story 3)', () => {
	const pin = '4321';
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

	it('skips existing structural records, flags duplicate transactions, and skips attachments on matched duplicates', async () => {
		// 1. Seed existing data in DB:
		const existingAccount = await AccountRepository.create(key, {
			name: 'Primary Checking',
			type: 'bank',
			openingBalance: 50000
		});

		const existingCategory = await CategoryRepository.create(key, {
			name: 'Dining Out',
			parentId: null
		});

		// Existing transaction
		const existingTx = await TransactionEngine.recordTransaction(
			key,
			{
				accountId: existingAccount.id,
				date: '2026-09-01',
				amount: -2500, // 25.00
				type: 'expense'
			},
			[{ categoryId: existingCategory.id, amount: -2500 }]
		);

		// 2. Prepare template containing:
		// - 'Primary Checking' account (same name -> skip)
		// - 'Dining Out' category (same name -> skip)
		// - 'Coffee' category (new -> create)
		// - Transaction matching existing date and amount (-2500 on 2026-09-01) -> create and flag!
		// - Attachment on the duplicate transaction -> skip!
		// - Transaction that is brand new (-1000 on 2026-09-05) -> create and confirm!
		const template: DataTemplate = {
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: new Date().toISOString(),
			entities: {
				accounts: [
					{
						id: 'file-acc-1',
						name: 'Primary Checking',
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
				categories: [
					{
						id: 'file-cat-1',
						name: 'Dining Out',
						parentId: null,
						icon: null,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					},
					{
						id: 'file-cat-2',
						name: 'Coffee',
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
				notificationPreference: null,
				debtPlannerPreference: null,
				transactions: [
					{
						id: 'file-tx-dup',
						accountId: 'file-acc-1',
						date: '2026-09-01',
						amount: -2500,
						type: 'expense',
						transferPairId: null,
						merchantId: null,
						notes: 'Duplicate lunch',
						source: 'manual',
						reviewStatus: 'confirmed',
						duplicateOfId: null,
						createdAt: 1000,
						updatedAt: 1000,
						deletedAt: null
					},
					{
						id: 'file-tx-new',
						accountId: 'file-acc-1',
						date: '2026-09-05',
						amount: -1000,
						type: 'expense',
						transferPairId: null,
						merchantId: null,
						notes: 'Morning coffee',
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
						id: 'file-split-1',
						transactionId: 'file-tx-dup',
						categoryId: 'file-cat-1',
						amount: -2500
					},
					{
						id: 'file-split-2',
						transactionId: 'file-tx-new',
						categoryId: 'file-cat-2',
						amount: -1000
					}
				],
				transactionTags: [],
				attachments: [
					{
						id: 'file-att-1',
						transactionId: 'file-tx-dup',
						mimeType: 'image/jpeg',
						data: 'duplicate_receipt_data',
						sizeBytes: 2048,
						createdAt: 1000,
						updatedAt: 1000
					}
				]
			}
		};

		const result = await importDataTemplate(key, template);

		// Verification of counts
		expect(result.perEntity.accounts?.skipped).toBe(1);
		expect(result.perEntity.accounts?.created).toBe(0);

		expect(result.perEntity.categories?.skipped).toBe(1);
		expect(result.perEntity.categories?.created).toBe(1); // 'Coffee' created

		expect(result.perEntity.transactions?.created).toBe(2);
		expect(result.perEntity.transactions?.flaggedDuplicate).toBe(1);

		expect(result.perEntity.attachments?.skipped).toBe(1);
		expect(result.perEntity.attachments?.created ?? 0).toBe(0);

		// Verify existing account was untouched and not duplicated
		const accounts = await AccountRepository.list(key);
		expect(accounts.length).toBe(1);
		expect(accounts[0].id).toBe(existingAccount.id);

		// Verify categories: 2 total (Dining Out, Coffee)
		const categories = await CategoryRepository.list(key);
		expect(categories.length).toBe(2);
		expect(categories.map((c) => c.name).sort()).toEqual(['Coffee', 'Dining Out']);

		// Verify transactions: 3 total (1 pre-existing, 1 flagged duplicate, 1 new confirmed)
		const allTxs = await TransactionRepository.search(key);
		expect(allTxs.length).toBe(3);

		const flaggedTx = allTxs.find((tx) => tx.duplicateOfId === existingTx.id);
		expect(flaggedTx).toBeDefined();
		expect(flaggedTx!.reviewStatus).toBe('unreviewed');

		const newTx = allTxs.find((tx) => tx.amount === -1000);
		expect(newTx).toBeDefined();
		expect(newTx!.duplicateOfId).toBeNull();
		expect(newTx!.reviewStatus).toBe('confirmed');

		// Verify no attachments were added to either transaction
		const attsForDup = await AttachmentRepository.listForTransaction(key, flaggedTx!.id);
		expect(attsForDup.length).toBe(0);
		const attsForExisting = await AttachmentRepository.listForTransaction(key, existingTx.id);
		expect(attsForExisting.length).toBe(0);
	});
});
