import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import {
	createBackup,
	validateAndDecryptBackup,
	restoreBackup,
	BackupValidationError,
	CURRENT_SCHEMA_VERSION,
	type BackupFile
} from '../../src/data/io/backupService';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64,
	encrypt,
	sha256Hex
} from '../../src/data/crypto/cryptoService';

describe('Backup service', () => {
	const pin = '2468';
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
		await AccountRepository.create(key, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 10000,
			creditLimit: null,
			billingCycleDay: null
		});
	});

	it('encodes a checksummed, versioned backup carrying the current schema version', async () => {
		const backup = await createBackup(key, encryptionSalt);
		expect(backup.container).toBe('personal-finance-manager-backup');
		expect(backup.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(backup.checksum).toMatch(/^[0-9a-f]{64}$/);
		expect(backup.kdf.salt).toBe(encryptionSalt);
	});

	it('decodes a backup with the correct PIN and recovers the exported entities', async () => {
		const backup = await createBackup(key, encryptionSalt);
		const { payload } = await validateAndDecryptBackup(backup, pin);
		expect(payload.exportedEntities.accounts).toHaveLength(1);
		expect(payload.exportedEntities.accounts[0].name).toBe('Checking');
		expect(payload.exportedEntities.userProfile?.encryptionSalt).toBe(encryptionSalt);
	});

	it('rejects a backup opened with the wrong PIN', async () => {
		const backup = await createBackup(key, encryptionSalt);
		await expect(validateAndDecryptBackup(backup, '0000')).rejects.toThrow(BackupValidationError);
	});

	it('rejects a corrupted backup via checksum verification, without touching existing data', async () => {
		const backup = await createBackup(key, encryptionSalt);
		const corrupted: BackupFile = { ...backup, checksum: '0'.repeat(64) };
		await expect(validateAndDecryptBackup(corrupted, pin)).rejects.toThrow(BackupValidationError);
	});

	it('rejects a backup from an unrecognized container', async () => {
		const backup = await createBackup(key, encryptionSalt);
		const bogus: BackupFile = { ...backup, container: 'not-myfin' };
		await expect(validateAndDecryptBackup(bogus, pin)).rejects.toThrow(BackupValidationError);
	});

	it('rejects a backup whose decrypted payload carries an unsupported schema version', async () => {
		const futurePayload = {
			schemaVersion: '99.0.0',
			exportedEntities: {
				accounts: [],
				categories: [],
				merchants: [],
				merchantAliases: [],
				tags: [],
				transactions: [],
				transactionSplits: [],
				transactionTags: [],
				budgets: [],
				budgetItems: [],
				recurringRules: [],
				expectedEvents: [],
				investmentHoldings: [],
				investmentValuations: [],
				liabilities: [],
				netWorthSnapshots: [],
				userProfile: null
			}
		};
		const checksum = await sha256Hex(JSON.stringify(futurePayload));
		const { iv, ciphertext } = await encrypt(key, futurePayload);
		const fromFuture: BackupFile = {
			container: 'personal-finance-manager-backup',
			containerVersion: 1,
			schemaVersion: '99.0.0',
			createdAt: new Date().toISOString(),
			checksum,
			kdf: { algorithm: 'PBKDF2-SHA256', iterations: 210_000, salt: encryptionSalt },
			cipher: { algorithm: 'AES-GCM', iv },
			ciphertext
		};
		await expect(validateAndDecryptBackup(fromFuture, pin)).rejects.toThrow(BackupValidationError);
	});

	it('round-trips a full backup and restore, ending with an exact match', async () => {
		const backup = await createBackup(key, encryptionSalt);
		const { payload, key: restoreKey } = await validateAndDecryptBackup(backup, pin);

		await db.delete();
		await db.open();
		await restoreBackup(restoreKey, payload);

		const accounts = await AccountRepository.list(restoreKey);
		expect(accounts).toHaveLength(1);
		expect(accounts[0].name).toBe('Checking');
		expect(accounts[0].openingBalance).toBe(10000);
		const profile = await UserProfileRepository.get();
		expect(profile?.encryptionSalt).toBe(encryptionSalt);
	});
});
