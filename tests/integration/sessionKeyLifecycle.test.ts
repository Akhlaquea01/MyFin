import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { SessionKeyRepository } from '../../src/data/dexie/sessionKeyRepository';
import {
	deriveEncryptionKey,
	randomSaltBase64,
	hashPin,
	BACKUP_PBKDF2_ITERATIONS,
	CryptoService
} from '../../src/data/crypto/cryptoService';
import {
	createBackup,
	validateAndDecryptBackup,
	deriveDataKeyForPayload,
	restoreBackup,
	BackupValidationError
} from '../../src/data/io/backupService';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';

/**
 * Guards the session-key exception carved out by Constitution Principle II (v2.0.0). The
 * amendment permits persisting the derived key as a non-extractable handle, on the explicit
 * condition that no code path can ever export its raw bytes and that the handle is cleared
 * when it stops being valid. Both are mechanical claims, so both are tested here.
 */
describe('session key persistence', () => {
	const pin = '482915';
	let encryptionSalt: string;
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		encryptionSalt = randomSaltBase64();
		key = await deriveEncryptionKey(pin, encryptionSalt);
	});

	it('never yields raw key bytes, even from the persisted handle', async () => {
		await SessionKeyRepository.save(key, Date.now() + 60_000);
		const restored = await SessionKeyRepository.restore();
		expect(restored).not.toBeNull();

		// The whole basis of the exception: the round-tripped handle is still non-extractable.
		expect(restored!.extractable).toBe(false);
		await expect(crypto.subtle.exportKey('raw', restored!)).rejects.toThrow();
		await expect(crypto.subtle.exportKey('jwk', restored!)).rejects.toThrow();
	});

	it('derives non-extractable keys in the first place', async () => {
		expect(key.extractable).toBe(false);
		await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
	});

	it('treats an expired handle as absent and deletes it', async () => {
		await SessionKeyRepository.save(key, Date.now() - 1);
		expect(await SessionKeyRepository.restore()).toBeNull();
		expect(await db.sessionKeys.get('local-session')).toBeUndefined();
	});

	it('clears the handle on explicit lock', async () => {
		await SessionKeyRepository.save(key, Date.now() + 60_000);
		await SessionKeyRepository.clear();
		expect(await db.sessionKeys.get('local-session')).toBeUndefined();
	});
});

describe('restore clears the stale session key', () => {
	const pin = '482915';

	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	/**
	 * Regression: `restoreBackup` re-encrypts every row under a key derived from the *backup's*
	 * salt, which is almost never the key the current session holds. A surviving session-key row
	 * silently resumed that old key after the reload that follows a restore, leaving the app
	 * "unlocked" holding a key that decrypts nothing — an unrecoverable state, since the lock
	 * screen was never reached to enter the correct PIN.
	 */
	it('leaves no resumable session pointing at the old key', async () => {
		const oldSalt = randomSaltBase64();
		const oldKey = await deriveEncryptionKey(pin, oldSalt);
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin(pin, pinSalt),
			pinSalt,
			encryptionSalt: oldSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: false
		});
		await AccountRepository.create(oldKey, {
			name: 'Everyday',
			type: 'bank',
			openingBalance: 100_00,
			creditLimit: null,
			billingCycleDay: null
		});

		// A live session, exactly as SessionContext.unlock() would leave it.
		await SessionKeyRepository.save(oldKey, Date.now() + 300_000);
		expect(await SessionKeyRepository.restore()).not.toBeNull();

		// A backup carrying a *different* encryption salt in its profile — the shape produced
		// by a backup made on another installation, where the restored database ends up keyed
		// differently from whatever this session is currently holding.
		const otherSalt = randomSaltBase64();
		const backup = await createBackup(oldKey, otherSalt, pin);
		const { payload } = await validateAndDecryptBackup(backup, pin);
		payload.exportedEntities.userProfile = {
			...payload.exportedEntities.userProfile!,
			encryptionSalt: otherSalt
		};

		const dataKey = await deriveDataKeyForPayload(payload, pin, otherSalt);
		await restoreBackup(dataKey, payload);

		// The restored rows are keyed to the backup's salt, so the session key that was live a
		// moment ago genuinely cannot read them any more.
		await expect(AccountRepository.list(oldKey)).rejects.toThrow();

		// Nothing left to silently resume: the next boot must go through the lock screen.
		expect(await SessionKeyRepository.restore()).toBeNull();
		expect(await db.sessionKeys.get('local-session')).toBeUndefined();
	});
});

describe('backup key derivation', () => {
	const pin = '482915';

	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it('records and uses the hardened backup iteration count', async () => {
		const salt = randomSaltBase64();
		const key = await deriveEncryptionKey(pin, salt);
		const backup = await createBackup(key, salt, pin);

		expect(backup.kdf.iterations).toBe(BACKUP_PBKDF2_ITERATIONS);
		// A backup must be strictly harder to attack offline than an interactive unlock, since
		// it leaves the device and can be guessed against without any throttle.
		expect(backup.kdf.iterations).toBeGreaterThan(CryptoService.PBKDF2_ITERATIONS);
	});

	it('honours the iteration count recorded in the file rather than the current constant', async () => {
		const salt = randomSaltBase64();
		const key = await deriveEncryptionKey(pin, salt);
		const backup = await createBackup(key, salt, pin);

		// Same bytes, but claiming a cost they were not written at: derivation yields a
		// different key, the GCM tag fails, and the file is rejected rather than half-read.
		const mislabelled = { ...backup, kdf: { ...backup.kdf, iterations: 210_000 } };
		await expect(validateAndDecryptBackup(mislabelled, pin)).rejects.toThrow(BackupValidationError);
	});

	it('rejects an absurd iteration count instead of hanging on it', async () => {
		const salt = randomSaltBase64();
		const key = await deriveEncryptionKey(pin, salt);
		const backup = await createBackup(key, salt, pin);

		for (const iterations of [0, -1, 1.5, 9_000_000_000] as number[]) {
			const hostile = { ...backup, kdf: { ...backup.kdf, iterations } };
			await expect(validateAndDecryptBackup(hostile, pin)).rejects.toThrow(BackupValidationError);
		}
	});

	it('restores to a database the interactive unlock key can read', async () => {
		const salt = randomSaltBase64();
		const sourceKey = await deriveEncryptionKey(pin, salt);
		await AccountRepository.create(sourceKey, {
			name: 'Savings',
			type: 'bank',
			openingBalance: 5_000_00,
			creditLimit: null,
			billingCycleDay: null
		});
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin(pin, pinSalt),
			pinSalt,
			encryptionSalt: salt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: false
		});
		const backup = await createBackup(sourceKey, salt, pin);

		const { payload } = await validateAndDecryptBackup(backup, pin);
		const dataKey = await deriveDataKeyForPayload(payload, pin, salt);
		await restoreBackup(dataKey, payload);

		// The key LockScreen will derive on the next unlock — interactive cost, profile salt.
		const unlockKey = await deriveEncryptionKey(pin, salt);
		const accounts = await AccountRepository.list(unlockKey);
		expect(accounts.map((a) => a.name)).toEqual(['Savings']);
	});
});
