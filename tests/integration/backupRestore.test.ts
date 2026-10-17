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
import { ImportMappingRepository } from '../../src/data/dexie/importMappingRepository';
import { presetFromMapping } from '../../src/domain/io/importMappingPresets';
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

		const accounts = await AccountRepository.list(restoreKey);
		expect(accounts.map((a) => a.name)).toEqual(['Checking']);

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
	it('drops remembered import layouts on restore, since they are sealed under the old key', async () => {
		const layout = ['Date', 'Merchant', 'Amount'];
		const input = presetFromMapping(layout, {
			dateColumn: 'Date',
			amountColumn: 'Amount',
			dateFormat: 'YYYY-MM-DD',
			amountSignConvention: 'negative-is-expense'
		});
		await ImportMappingRepository.save(key, input);
		const backup = await createBackup(key, encryptionSalt, pin);
		const { payload } = await validateAndDecryptBackup(backup, pin);

		// Restoring onto a device that has a different PIN and salt: the data key changes.
		const otherPin = '2468';
		const otherSalt = randomSaltBase64();
		const restoreKey = await deriveEncryptionKey(otherPin, otherSalt);
		payload.exportedEntities.userProfile = {
			...payload.exportedEntities.userProfile!,
			encryptionSalt: otherSalt
		};
		await restoreBackup(restoreKey, payload);

		expect(await db.importMappings.count()).toBe(0);
		await expect(ImportMappingRepository.save(restoreKey, input)).resolves.toMatchObject({
			signature: input.signature
		});
	});

	it('does not let one unreadable remembered layout stop the importer remembering new ones', async () => {
		const layout = ['Date', 'Merchant', 'Amount'];
		const input = presetFromMapping(layout, {
			dateColumn: 'Date',
			amountColumn: 'Amount',
			dateFormat: 'YYYY-MM-DD',
			amountSignConvention: 'negative-is-expense'
		});
		const staleKey = await deriveEncryptionKey('1357', randomSaltBase64());
		await ImportMappingRepository.save(staleKey, input);

		expect(await ImportMappingRepository.list(key)).toEqual([]);
		const saved = await ImportMappingRepository.save(key, input);
		expect((await ImportMappingRepository.list(key)).map((p) => p.id)).toEqual([saved.id]);
	});
});
