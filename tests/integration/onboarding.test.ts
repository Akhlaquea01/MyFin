import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, type AccountRow } from '../../src/data/dexie/db';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import {
	hashPin,
	verifyPin,
	deriveEncryptionKey,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';
import { putEncrypted, getDecrypted } from '../../src/data/dexie/encryptedTable';
import { NOT_DELETED } from '../../src/data/dexie/indexable';
import type { Account } from '../../src/domain/entities';
import { DEFAULT_AUTO_LOCK_TIMEOUT_MS } from '../../src/domain/entities';

describe('Onboarding: PIN setup persists UserProfile and gates data access', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it('creates exactly one UserProfile row on first-run setup', async () => {
		expect(await UserProfileRepository.exists()).toBe(false);

		const pinSalt = randomSaltBase64();
		const encryptionSalt = randomSaltBase64();
		const pinVerifierHash = await hashPin('2468', pinSalt);

		await UserProfileRepository.create({
			pinVerifierHash,
			pinSalt,
			encryptionSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: DEFAULT_AUTO_LOCK_TIMEOUT_MS,
			storagePersisted: false
		});

		expect(await UserProfileRepository.exists()).toBe(true);
		const profile = await UserProfileRepository.get();
		expect(profile?.autoLockTimeoutMs).toBe(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
	});

	it('gates decryption of stored data behind the correct PIN', async () => {
		const pinSalt = randomSaltBase64();
		const encryptionSalt = randomSaltBase64();
		const pinVerifierHash = await hashPin('2468', pinSalt);
		await UserProfileRepository.create({
			pinVerifierHash,
			pinSalt,
			encryptionSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: DEFAULT_AUTO_LOCK_TIMEOUT_MS,
			storagePersisted: false
		});

		const correctKey = await deriveEncryptionKey('2468', encryptionSalt);
		const account: Account = {
			id: 'acc-1',
			name: 'Checking',
			type: 'bank',
			openingBalance: 100000,
			currentBalance: 100000,
			creditLimit: null,
			billingCycleDay: null,
			isArchived: false,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			deletedAt: null
		};
		await putEncrypted(db.accounts, correctKey, account, { deletedAt: NOT_DELETED });

		const readBack = await getDecrypted<AccountRow, Account>(db.accounts, correctKey, 'acc-1');
		expect(readBack?.name).toBe('Checking');

		const wrongKey = await deriveEncryptionKey('0000', encryptionSalt);
		await expect(
			getDecrypted<AccountRow, Account>(db.accounts, wrongKey, 'acc-1')
		).rejects.toThrow();
	});

	it('rejects an incorrect PIN at verification, before any key is derived', async () => {
		const pinSalt = randomSaltBase64();
		const pinVerifierHash = await hashPin('2468', pinSalt);
		expect(await verifyPin('0000', pinSalt, pinVerifierHash)).toBe(false);
		expect(await verifyPin('2468', pinSalt, pinVerifierHash)).toBe(true);
	});
});
