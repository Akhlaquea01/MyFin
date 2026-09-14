import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { SessionKeyRepository } from '../../src/data/dexie/sessionKeyRepository';
import { clearAllTables } from '../../src/data/dexie/clearAllTables';
import { resetAllData } from '../../src/data/io/resetService';
import { deriveEncryptionKey, hashPin, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

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
});
