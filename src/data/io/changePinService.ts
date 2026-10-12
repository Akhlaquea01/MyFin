// Changing the PIN. The PIN derives the key every row in the database is encrypted under, so a
// new PIN means re-encrypting everything — the same operation a backup restore performs, which is
// reused here: read the whole database into a payload under the old key, swap in a profile that
// carries the new PIN's verifier and salts, and write it back under the new key in ONE
// transaction. A failure rolls back and leaves the old PIN and the old data untouched.
import { db } from '../dexie/db';
import { UserProfileRepository } from '../dexie/userProfileRepository';
import {
	decrypt,
	deriveEncryptionKey,
	encrypt,
	hashPin,
	randomSaltBase64
} from '../crypto/cryptoService';
import { collectPayload, restoreBackup } from './backupService';
import { validatePin } from '../../domain/auth/pinPolicy';
import { clearNativeBiometric, isNativeBiometricAvailable } from '../../lib/native/nativeBiometric';
import type { UserProfile } from '../../domain/entities';

export class ChangePinError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ChangePinError';
	}
}

/**
 * Re-encrypts the database under `newPin`. `oldKey` is the current session key and the caller has
 * already verified the current PIN. Biometric enrollment is dropped on purpose: it wraps the OLD
 * PIN, so it could only ever hand back a PIN that no longer works.
 *
 * The session key row is cleared by the restore, so the caller must lock the session afterwards;
 * the next unlock uses the new PIN.
 */
export async function changePin(
	oldKey: CryptoKey,
	currentPin: string,
	newPin: string
): Promise<void> {
	const validation = validatePin(newPin);
	if (!validation.ok) throw new ChangePinError(validation.message);
	if (newPin === currentPin)
		throw new ChangePinError('Choose a PIN different from the current one.');

	const profile = await UserProfileRepository.get();
	if (!profile) throw new ChangePinError('No profile found.');

	const pinSalt = randomSaltBase64();
	const encryptionSalt = randomSaltBase64();
	const pinVerifierHash = await hashPin(newPin, pinSalt);
	const newKey = await deriveEncryptionKey(newPin, encryptionSalt);

	const payload = await collectPayload(oldKey);

	// Everything not encrypted per row must follow the new key too: the captured-message sealing
	// key's private half is wrapped by the data key.
	const capture = profile.capture;
	let rewrappedCapture = capture;
	if (capture?.sealing) {
		const privateKeyPkcs8 = await decrypt<string>(oldKey, capture.sealing.wrappedPrivateKey);
		rewrappedCapture = {
			...capture,
			sealing: {
				...capture.sealing,
				wrappedPrivateKey: await encrypt(newKey, privateKeyPkcs8)
			}
		};
	}

	const nextProfile: UserProfile = {
		...profile,
		pinVerifierHash,
		pinSalt,
		encryptionSalt,
		biometricEnabled: false,
		failedUnlockAttempts: 0,
		lockedOutUntil: null,
		...(rewrappedCapture ? { capture: rewrappedCapture } : {})
	};
	delete nextProfile.nativeBiometric;
	delete nextProfile.webauthn;
	payload.exportedEntities.userProfile = nextProfile;

	await restoreBackup(newKey, payload);

	// Device-local convenience data encrypted under the old key and not part of a backup. Left in
	// place it would be unreadable; it is only remembered import column layouts.
	await db.importMappings.clear();
	if (isNativeBiometricAvailable()) await clearNativeBiometric();
}
