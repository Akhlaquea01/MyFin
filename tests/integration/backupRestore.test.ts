import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TagRepository, TransactionTagRepository } from '../../src/data/dexie/tagRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { BudgetRepository } from '../../src/data/dexie/budgetRepository';
import { RecurringRepository } from '../../src/data/dexie/recurringRepository';
import {
	InvestmentHoldingRepository,
	LiabilityRepository
} from '../../src/data/dexie/wealthRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import {
	createBackup,
	validateAndDecryptBackup,
	deriveDataKeyForPayload,
	restoreBackup
} from '../../src/data/io/backupService';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

describe('Backup-then-restore round trip against Dexie', () => {
	const pin = '3579';
	let key: CryptoKey;
	let encryptionSalt: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		encryptionSalt = randomSaltBase64();
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

	it('restores an exact match of accounts, ledger, budgets, recurring rules, and wealth data', async () => {
		const checking = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		const oldWallet = await AccountRepository.create(key, {
			name: 'Old Wallet',
			type: 'wallet',
			openingBalance: 0,
			creditLimit: null,
			billingCycleDay: null
		});
		await AccountRepository.softDelete(key, oldWallet.id);

		const groceries = await CategoryRepository.create(key, { name: 'Groceries' });
		const tag = await TagRepository.getOrCreate(key, 'reimbursable');
		const tx = await TransactionRepository.create(
			key,
			{ accountId: checking.id, date: '2026-03-05', amount: -3000, type: 'expense' },
			[{ categoryId: groceries.id, amount: -3000 }]
		);
		await TransactionTagRepository.setTags(tx.id, [tag.id]);

		await BudgetRepository.create(key, {
			categoryId: groceries.id,
			periodType: 'monthly',
			amount: 10000,
			rolloverEnabled: false,
			isSinkingFund: false
		});
		await RecurringRepository.create(key, {
			accountId: checking.id,
			categoryId: groceries.id,
			amount: -2000,
			frequency: 'monthly',
			dayOfPeriod: 1
		});
		const holding = await InvestmentHoldingRepository.create(key, {
			name: 'Index Fund',
			type: 'mutual fund',
			costBasis: 50000
		});
		await LiabilityRepository.create(key, {
			name: 'Car Loan',
			type: 'loan',
			outstandingBalance: 20000,
			emiAmount: null,
			emiDueDay: null
		});

		const backup = await createBackup(key, encryptionSalt, pin);
		const { payload } = await validateAndDecryptBackup(backup, pin);
		const restoreKey = await deriveDataKeyForPayload(payload, pin, encryptionSalt);

		await db.delete();
		await db.open();
		await restoreBackup(restoreKey, payload);

		// Active accounts list excludes the soft-deleted one by design, but it must still
		// exist in the restored database (trash is data too, not a side effect to drop).
		const activeAccounts = await AccountRepository.list(restoreKey);
		expect(activeAccounts.map((a) => a.name)).toEqual(['Checking']);
		const allAccountRows = await db.accounts.toArray();
		expect(allAccountRows).toHaveLength(2);

		const transactions = await TransactionRepository.search(restoreKey, { accountId: checking.id });
		expect(transactions).toHaveLength(1);
		expect(transactions[0].amount).toBe(-3000);
		const restoredTagIds = await TransactionTagRepository.getTagIds(tx.id);
		expect(restoredTagIds).toEqual([tag.id]);

		const budgets = await BudgetRepository.list(restoreKey);
		expect(budgets).toHaveLength(1);
		expect(budgets[0].amount).toBe(10000);

		const recurringRules = await RecurringRepository.list(restoreKey);
		expect(recurringRules).toHaveLength(1);

		const holdings = await InvestmentHoldingRepository.list(restoreKey);
		expect(holdings.map((h) => h.id)).toEqual([holding.id]);

		const liabilities = await LiabilityRepository.list(restoreKey);
		expect(liabilities).toHaveLength(1);

		const profile = await UserProfileRepository.get();
		expect(profile?.pinSalt).toBeTruthy();
		expect(await UserProfileRepository.exists()).toBe(true);
	});

	it('leaves existing data untouched when restore validation fails', async () => {
		await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 5000,
			creditLimit: null,
			billingCycleDay: null
		});
		const backup = await createBackup(key, encryptionSalt, pin);
		const corrupted = { ...backup, checksum: '0'.repeat(64) };

		await expect(validateAndDecryptBackup(corrupted, pin)).rejects.toThrow();

		const accounts = await AccountRepository.list(key);
		expect(accounts).toHaveLength(1);
		expect(accounts[0].name).toBe('Checking');
	});
});
