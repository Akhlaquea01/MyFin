import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { TransactionRepository } from '../../src/data/dexie/transactionRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { SessionKeyRepository } from '../../src/data/dexie/sessionKeyRepository';
import { ChangePinError, changePin } from '../../src/data/io/changePinService';
import { checkPinWithThrottle } from '../../src/data/auth/pinGate';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64,
	verifyPin
} from '../../src/data/crypto/cryptoService';
import { createSealingKey, loadSealingPrivateKey } from '../../src/data/crypto/sealedBox';

describe('changePin', () => {
	const oldPin = '482915';
	const newPin = '739204';
	let oldKey: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		const encryptionSalt = randomSaltBase64();
		oldKey = await deriveEncryptionKey(oldPin, encryptionSalt);
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin(oldPin, pinSalt),
			pinSalt,
			encryptionSalt,
			biometricEnabled: true,
			nativeBiometric: { wrappedPin: { iv: 'x', ciphertext: 'y' }, enrolledAt: 1 },
			autoLockTimeoutMs: 300_000,
			storagePersisted: true,
			failedUnlockAttempts: 2
		});
		await SessionKeyRepository.save(oldKey, Date.now() + 300_000);
	});

	async function seedLedger() {
		const account = await AccountRepository.create(oldKey, {
			name: 'Checking',
			type: 'bank',
			openingBalance: 100000,
			creditLimit: null,
			billingCycleDay: null
		});
		const category = await CategoryRepository.create(oldKey, { name: 'Groceries' });
		await TransactionRepository.create(
			oldKey,
			{ accountId: account.id, date: '2026-03-05', amount: -3000, type: 'expense' },
			[{ categoryId: category.id, amount: -3000 }]
		);
		return { account, category };
	}

	it('re-encrypts the whole ledger under a key derived from the new PIN', async () => {
		await seedLedger();

		await changePin(oldKey, oldPin, newPin);

		const profile = (await UserProfileRepository.get())!;
		const newKey = await deriveEncryptionKey(newPin, profile.encryptionSalt);

		expect(await verifyPin(newPin, profile.pinSalt, profile.pinVerifierHash)).toBe(true);
		expect(await verifyPin(oldPin, profile.pinSalt, profile.pinVerifierHash)).toBe(false);

		const accounts = await AccountRepository.list(newKey, true);
		expect(accounts.map((a) => a.name)).toEqual(['Checking']);
		expect(await CategoryRepository.list(newKey)).toHaveLength(1);
		const transactions = await TransactionRepository.search(newKey);
		expect(transactions).toHaveLength(1);
		expect(transactions[0].amount).toBe(-3000);
	});

	it('leaves the old key unable to read the data', async () => {
		await seedLedger();

		await changePin(oldKey, oldPin, newPin);

		await expect(AccountRepository.list(oldKey, true)).rejects.toThrow();
	});

	it('drops biometric enrollment, resets the lockout counter and forces a fresh unlock', async () => {
		await seedLedger();

		await changePin(oldKey, oldPin, newPin);

		const profile = (await UserProfileRepository.get())!;
		expect(profile.biometricEnabled).toBe(false);
		expect(profile.nativeBiometric).toBeUndefined();
		expect(profile.webauthn).toBeUndefined();
		expect(profile.failedUnlockAttempts).toBe(0);
		expect(await db.sessionKeys.count()).toBe(0);
	});

	it('keeps the captured-message sealing key openable with the new PIN', async () => {
		const sealing = await createSealingKey(oldKey);
		await UserProfileRepository.update({
			capture: {
				enabled: true,
				sms: true,
				notifications: true,
				defaultAccountId: null,
				sealing
			}
		});

		await changePin(oldKey, oldPin, newPin);

		const profile = (await UserProfileRepository.get())!;
		const newKey = await deriveEncryptionKey(newPin, profile.encryptionSalt);
		const wrapped = profile.capture!.sealing!.wrappedPrivateKey;
		await expect(loadSealingPrivateKey(newKey, wrapped)).resolves.toBeDefined();
		await expect(loadSealingPrivateKey(oldKey, wrapped)).rejects.toThrow();
		expect(profile.capture!.sealing!.publicKey).toBe(sealing.publicKey);
	});

	it('rejects a weak or unchanged PIN without touching anything', async () => {
		await seedLedger();
		const before = (await UserProfileRepository.get())!;

		await expect(changePin(oldKey, oldPin, '123456')).rejects.toBeInstanceOf(ChangePinError);
		await expect(changePin(oldKey, oldPin, oldPin)).rejects.toBeInstanceOf(ChangePinError);

		const after = (await UserProfileRepository.get())!;
		expect(after.pinVerifierHash).toBe(before.pinVerifierHash);
		expect(await AccountRepository.list(oldKey, true)).toHaveLength(1);
	});
});

describe('checkPinWithThrottle', () => {
	const pin = '482915';

	beforeEach(async () => {
		await db.delete();
		await db.open();
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin(pin, pinSalt),
			pinSalt,
			encryptionSalt: randomSaltBase64(),
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
	});

	it('accepts the right PIN', async () => {
		const result = await checkPinWithThrottle(pin);
		expect(result.ok).toBe(true);
	});

	it('counts wrong attempts toward the shared lockout and then refuses even the right PIN', async () => {
		for (let i = 0; i < 5; i++) {
			const wrong = await checkPinWithThrottle('000001');
			expect(wrong.ok).toBe(false);
		}
		const profile = (await UserProfileRepository.get())!;
		expect(profile.failedUnlockAttempts).toBe(5);
		expect(profile.lockedOutUntil).not.toBeNull();

		const blocked = await checkPinWithThrottle(pin);
		expect(blocked).toMatchObject({ ok: false, reason: 'locked-out' });
	});

	it('clears the counter after a correct PIN', async () => {
		await checkPinWithThrottle('000001');
		await checkPinWithThrottle('000001');
		expect((await UserProfileRepository.get())!.failedUnlockAttempts).toBe(2);

		const result = await checkPinWithThrottle(pin);

		expect(result.ok).toBe(true);
		expect((await UserProfileRepository.get())!.failedUnlockAttempts).toBe(0);
	});
});
