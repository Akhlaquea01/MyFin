import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { SessionKeyRepository } from '../../src/data/dexie/sessionKeyRepository';
import { AutoBackupSettingsRepository } from '../../src/data/dexie/autoBackupSettingsRepository';
import { ImportMappingRepository } from '../../src/data/dexie/importMappingRepository';
import { clearAllTables } from '../../src/data/dexie/clearAllTables';
import { resetAllData } from '../../src/data/io/resetService';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

// spec 016, FR-013/014: Clear All Data must wipe every table, including the PIN/security vault
// (userProfile, sessionKeys) — not just financial data — per the feature's clarification that
// this is a full reset back to true first-run onboarding.
describe('clearAllTables / resetAllData', () => {
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
		await SessionKeyRepository.save(key, Date.now() + 300_000);
	});

	it('empties every financial table and the PIN/security vault', async () => {
		const account = await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 10000,
			creditLimit: null,
			billingCycleDay: null
		});
		const category = await CategoryRepository.create(key, { name: 'Groceries' });
		await TransactionRepository.create(
			key,
			{ accountId: account.id, date: '2026-06-10', amount: -1000, type: 'expense' },
			[{ categoryId: category.id, amount: -1000 }]
		);

		expect(await UserProfileRepository.get()).not.toBeUndefined();

		await clearAllTables();

		expect(await AccountRepository.list(key, true)).toHaveLength(0);
		expect(await CategoryRepository.list(key)).toHaveLength(0);
		expect(await TransactionRepository.search(key)).toHaveLength(0);
		expect(await UserProfileRepository.get()).toBeUndefined();
		expect(await db.sessionKeys.count()).toBe(0);
	});

	it('resetAllData delegates to the same full wipe', async () => {
		await AccountRepository.create(key, {
			name: 'Wallet',
			type: 'cash',
			openingBalance: 500,
			creditLimit: null,
			billingCycleDay: null
		});

		await resetAllData();

		expect(await AccountRepository.list(key, true)).toHaveLength(0);
		expect(await UserProfileRepository.get()).toBeUndefined();
	});

	describe('device-local settings', () => {
		async function seedLocalSettings() {
			await AutoBackupSettingsRepository.update({
				enabled: true,
				intervalDays: 7,
				lastBackupAt: '2026-06-01T00:00:00.000Z',
				lastBackupStatus: 'success'
			});
			await db.backupRecords.put({
				id: 'record-1',
				schemaVersion: '1.4',
				sizeBytes: 123,
				checksum: 'abc',
				createdAt: Date.now(),
				updatedAt: Date.now()
			} as never);
			await ImportMappingRepository.save(key, {
				signature: '["amount","date"]',
				dateColumn: 'Date',
				dateFormat: 'YYYY-MM-DD',
				amountSignConvention: 'negative-is-expense',
				amountColumn: 'Amount',
				debitColumn: null,
				creditColumn: null,
				descriptionColumn: null,
				accountColumn: null
			});
		}

		it('a full reset also clears the scheduled-backup configuration, the backup log and remembered import mappings', async () => {
			await seedLocalSettings();
			expect((await AutoBackupSettingsRepository.get()).enabled).toBe(true);
			expect(await db.backupRecords.count()).toBe(1);

			await resetAllData();

			// Back to defaults: nothing left that could back up the next user's data to the old folder.
			const settings = await AutoBackupSettingsRepository.get();
			expect(settings.enabled).toBe(false);
			expect(settings.lastBackupAt).toBeUndefined();
			expect(await db.autoBackupSettings.count()).toBe(0);
			expect(await db.backupRecords.count()).toBe(0);
			expect(await db.importMappings.count()).toBe(0);
		});

		it('clearAllTables on its own — what a backup restore uses — leaves them alone', async () => {
			await seedLocalSettings();

			await clearAllTables();

			expect((await AutoBackupSettingsRepository.get()).enabled).toBe(true);
			expect(await db.backupRecords.count()).toBe(1);
			expect(await db.importMappings.count()).toBe(1);
		});
	});
});
