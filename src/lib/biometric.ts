// One entry point for biometric unlock. In the Android app it uses the native plugin (fingerprint
// via BiometricPrompt); in a browser or installed PWA it uses WebAuthn+PRF as before. Either way
// biometric is only an alternate way to recover the PIN, which then goes through the normal
// PIN verification and key derivation — it never bypasses the PIN (Constitution Principle II).
import {
	enrollBiometric,
	isWebAuthnSupported,
	retryPrfEval,
	unlockPinWithBiometric,
	type BiometricUnavailableReason,
	type PendingBiometricEnrollment
} from './webauthn';
import {
	authenticateNativeBiometric,
	clearNativeBiometric,
	enrollNativeBiometric,
	getNativeBiometricStatus,
	isNativeBiometricAvailable,
	NativeBiometricError,
	type NativeAvailabilityReason,
	type NativeOpReason,
	type NativePromptOptions
} from './native/nativeBiometric';
import { unwrapPin, wrapPin } from './pinWrap';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';
import type { UserProfile } from '../domain/entities';

export type BiometricProvider = 'native' | 'webauthn' | 'none';

export type BiometricReason =
	| NativeAvailabilityReason
	| NativeOpReason
	| BiometricUnavailableReason
	/** The stored wrapped PIN no longer opens with the stored secret. */
	| 'stale';

export interface BiometricAvailability {
	provider: BiometricProvider;
	available: boolean;
	reason?: BiometricReason;
}

export type EnrollResult =
	| { ok: true; profilePatch: Partial<Omit<UserProfile, 'id'>> }
	| { ok: false; reason: BiometricReason; pending?: PendingBiometricEnrollment };

export type UnlockResult =
	| { ok: true; pin: string }
	/** `clearEnrollment`: the stored enrollment can never work again — drop it so the user is not
	 *  offered a button that fails every time. */
	| { ok: false; reason: BiometricReason; clearEnrollment?: boolean };

/** Profile fields that remove every kind of biometric enrollment. Dexie's `update` deletes a
 *  key whose value is `undefined`. */
export const CLEAR_BIOMETRIC_PATCH: Partial<Omit<UserProfile, 'id'>> = {
	biometricEnabled: false,
	nativeBiometric: undefined,
	webauthn: undefined
};

const PROMPT: NativePromptOptions = {
	title: 'Unlock MyFin',
	subtitle: 'Use your fingerprint instead of your PIN',
	cancelLabel: 'Use PIN'
};

export function getBiometricProvider(): BiometricProvider {
	if (isNativeBiometricAvailable()) return 'native';
	return isWebAuthnSupported() ? 'webauthn' : 'none';
}

function reasonOf(err: unknown): BiometricReason {
	return err instanceof NativeBiometricError ? err.reason : 'error';
}

export async function getBiometricAvailability(): Promise<BiometricAvailability> {
	const provider = getBiometricProvider();
	if (provider === 'none') return { provider, available: false, reason: 'unsupported' };
	if (provider === 'webauthn') return { provider, available: true };
	try {
		const status = await getNativeBiometricStatus();
		return { provider, available: status.available, reason: status.reason };
	} catch (err) {
		return { provider, available: false, reason: reasonOf(err) };
	}
}

/** Whether this profile has a working enrollment for the current environment. */
export async function isBiometricEnrolled(
	profile: UserProfile | null | undefined
): Promise<boolean> {
	if (!profile) return false;
	const provider = getBiometricProvider();
	if (provider === 'webauthn') return !!profile.webauthn;
	if (provider === 'native') {
		if (!profile.nativeBiometric) return false;
		try {
			const status = await getNativeBiometricStatus();
			return status.available && status.enrolled && !status.invalidated;
		} catch {
			return false;
		}
	}
	return false;
}

/** Enrolls with whichever provider applies. `pending` is only produced by the WebAuthn path. */
export async function enrollBiometricUnlock(
	pin: string,
	pendingRetry?: PendingBiometricEnrollment | null
): Promise<EnrollResult> {
	const provider = getBiometricProvider();
	if (provider === 'none') return { ok: false, reason: 'unsupported' };

	if (provider === 'webauthn') {
		const result = pendingRetry
			? await retryPrfEval(pendingRetry, pin)
			: await enrollBiometric(pin);
		if (!result.ok) return { ok: false, reason: result.reason, pending: result.pending };
		return { ok: true, profilePatch: { biometricEnabled: true, webauthn: result.enrollment } };
	}

	try {
		const secret = await enrollNativeBiometric({
			...PROMPT,
			title: 'Turn on fingerprint unlock',
			subtitle: 'Confirm your fingerprint to finish setting up',
			cancelLabel: 'Cancel'
		});
		const wrappedPin = await wrapPin(secret, pin);
		return {
			ok: true,
			profilePatch: {
				biometricEnabled: true,
				nativeBiometric: { wrappedPin, enrolledAt: Date.now() }
			}
		};
	} catch (err) {
		// A half-made enrollment would leave a key nothing refers to.
		await clearNativeBiometric();
		return { ok: false, reason: reasonOf(err) };
	}
}

/** Recovers the PIN through a biometric check. Never touches the failed-PIN counter. */
export async function unlockWithBiometric(profile: UserProfile): Promise<UnlockResult> {
	const provider = getBiometricProvider();

	if (provider === 'webauthn') {
		if (!profile.webauthn) return { ok: false, reason: 'not-enrolled' };
		const pin = await unlockPinWithBiometric(profile.webauthn);
		return pin ? { ok: true, pin } : { ok: false, reason: 'error' };
	}
	if (provider === 'none') return { ok: false, reason: 'unsupported' };

	if (!profile.nativeBiometric) return { ok: false, reason: 'not-enrolled' };
	let secret: string;
	try {
		secret = await authenticateNativeBiometric(PROMPT);
	} catch (err) {
		const reason = reasonOf(err);
		const dead = reason === 'invalidated' || reason === 'not-enrolled';
		return { ok: false, reason, clearEnrollment: dead };
	}
	try {
		return { ok: true, pin: await unwrapPin(secret, profile.nativeBiometric.wrappedPin) };
	} catch {
		return { ok: false, reason: 'stale', clearEnrollment: true };
	}
}

/** Removes the enrollment everywhere: the native secret and key, and the profile fields. */
export async function disableBiometric(): Promise<UserProfile> {
	await clearNativeBiometric();
	return UserProfileRepository.update(CLEAR_BIOMETRIC_PATCH);
}

/** Specific, honest text for why biometric unlock is not working (Constitution Principle II). */
export function describeBiometricReason(reason: BiometricReason): string {
	switch (reason) {
		case 'no-hardware':
			return 'This phone has no fingerprint sensor that Android rates as strong enough to protect keys (some face unlock is rated too weak). You can keep using your PIN.';
		case 'hw-unavailable':
			return 'The fingerprint sensor is not available right now. Try again in a moment, or use your PIN.';
		case 'none-enrolled':
			return 'No fingerprint is set up on this phone. Add one in Android Settings > Security, then turn this on again.';
		case 'security-update-required':
			return 'Android needs a security update before the fingerprint sensor can be used for this.';
		case 'unsupported':
			return "This device or browser doesn't support biometric unlock. You can keep using your PIN.";
		case 'cancelled':
			return 'Fingerprint check was cancelled.';
		case 'lockout':
			return 'Too many failed fingerprint attempts. Wait a little, or use your PIN.';
		case 'lockout-permanent':
			return 'Fingerprint is locked until you unlock the phone with its screen lock. Use your PIN for now.';
		case 'timeout':
			return 'The fingerprint prompt timed out. Tap the button to try again, or use your PIN.';
		case 'invalidated':
			return 'Fingerprint unlock was turned off because the fingerprints on this phone changed. Enter your PIN, then turn it on again.';
		case 'stale':
			return 'Your saved fingerprint unlock is out of date (for example after restoring a backup). Enter your PIN, then turn it on again.';
		case 'not-enrolled':
			return 'Fingerprint unlock is not set up. Enter your PIN, then turn it on again.';
		case 'not-ready':
			return 'The app was not in the foreground. Tap the fingerprint button to try again.';
		case 'busy':
			return 'A fingerprint check is already in progress.';
		case 'no-prf':
			return "Your device's fingerprint sensor doesn't support the secure key derivation (PRF) this app requires for biometric unlock — this is a hardware/browser limitation, not a bug. You can keep using your PIN.";
		case 'prf-eval-failed':
			return 'Your fingerprint sensor reported support for secure key derivation but the verification step failed. You can retry, or keep using your PIN if it does not work.';
		case 'error':
			return 'Something went wrong with biometric unlock. You can retry, or keep using your PIN.';
	}
}
