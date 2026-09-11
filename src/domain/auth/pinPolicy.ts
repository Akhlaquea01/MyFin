/**
 * PIN strength rules and unlock throttling maths (Constitution Principle II).
 *
 * Pure — no I/O, no framework — so the policy that ultimately guards every rupee in the
 * database is independently testable.
 *
 * Context: the PIN is the *only* secret in this system. It derives the data encryption key,
 * and it is also the sole protection on any backup file the user exports — a file explicitly
 * designed to leave the device. Because the backup container records its own KDF parameters
 * in cleartext and AES-GCM's auth tag confirms a correct guess, an attacker holding a backup
 * can verify candidate PINs offline, as fast as their hardware allows. A 4-digit PIN is
 * 10,000 candidates; that is not a meaningful search space at any iteration count.
 *
 * Two independent mitigations follow from that: raise the floor on PIN entropy (here), and
 * make online guessing expensive (`nextLockoutMs`).
 */

/** Minimum digits. Six is the floor at which the online throttle below buys real time. */
export const MIN_PIN_LENGTH = 6;
export const MAX_PIN_LENGTH = 12;

/** Free attempts before throttling begins — enough that an honest typo is never punished. */
export const FREE_UNLOCK_ATTEMPTS = 4;
const BASE_LOCKOUT_MS = 1_000;
export const MAX_LOCKOUT_MS = 5 * 60_000;

export type PinRejectionReason = 'length' | 'non-digit' | 'sequential' | 'repeated' | 'common';

export type PinValidation =
	{ ok: true } | { ok: false; reason: PinRejectionReason; message: string };

/** PINs that dominate every real-world breach corpus; rejected regardless of length. */
const COMMON_PINS = new Set([
	'000000',
	'111111',
	'121212',
	'112233',
	'123123',
	'654321',
	'666666',
	'696969',
	'999999',
	'123456',
	'1234567',
	'12345678',
	'123456789',
	'1234567890',
	'098765',
	'987654',
	'159753',
	'101010',
	'555555',
	'777777',
	'888888',
	'222222',
	'333333',
	'444444'
]);

function isAllSameDigit(pin: string): boolean {
	return new Set(pin).size === 1;
}

/** True for a strictly ascending or descending run of consecutive digits (123456, 654321). */
function isSequential(pin: string): boolean {
	let ascending = true;
	let descending = true;
	for (let i = 1; i < pin.length; i++) {
		const delta = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
		if (delta !== 1) ascending = false;
		if (delta !== -1) descending = false;
	}
	return ascending || descending;
}

/**
 * Validates a candidate PIN against the entropy floor. Returns a specific reason so the UI
 * can say what is actually wrong rather than restating the rules (Principle: honest,
 * specific failure messages — the same standard the biometric fallback already meets).
 */
export function validatePin(pin: string): PinValidation {
	if (!/^\d+$/.test(pin)) {
		return { ok: false, reason: 'non-digit', message: 'Your PIN can only contain digits.' };
	}
	if (pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) {
		return {
			ok: false,
			reason: 'length',
			message: `Your PIN must be ${MIN_PIN_LENGTH}-${MAX_PIN_LENGTH} digits.`
		};
	}
	if (isAllSameDigit(pin)) {
		return {
			ok: false,
			reason: 'repeated',
			message: 'Choose a PIN that isn’t the same digit repeated.'
		};
	}
	if (isSequential(pin)) {
		return {
			ok: false,
			reason: 'sequential',
			message: 'Choose a PIN that isn’t a run of consecutive digits.'
		};
	}
	if (COMMON_PINS.has(pin)) {
		return {
			ok: false,
			reason: 'common',
			message: 'That PIN is one of the most commonly used. Choose another.'
		};
	}
	return { ok: true };
}

/**
 * How long to refuse further unlock attempts after `failedAttempts` consecutive failures.
 * Zero while within the free allowance, then doubling from one second, capped at
 * `MAX_LOCKOUT_MS`. Capping rather than escalating forever is deliberate: this is a local
 * app with no account recovery, and a permanent lockout would destroy the user's own data
 * access over what is usually a forgotten PIN, not an attack.
 */
export function nextLockoutMs(failedAttempts: number): number {
	if (failedAttempts <= FREE_UNLOCK_ATTEMPTS) return 0;
	const exponent = failedAttempts - FREE_UNLOCK_ATTEMPTS - 1;
	// 2**exponent overflows to Infinity well before this matters; clamp the exponent first.
	if (exponent >= 32) return MAX_LOCKOUT_MS;
	return Math.min(BASE_LOCKOUT_MS * 2 ** exponent, MAX_LOCKOUT_MS);
}

/** Whether an unlock attempt is currently permitted, and if not, for how much longer. */
export function unlockGate(
	lockedOutUntil: number | null,
	now: number
): { allowed: true } | { allowed: false; remainingMs: number } {
	if (lockedOutUntil === null || now >= lockedOutUntil) return { allowed: true };
	return { allowed: false, remainingMs: lockedOutUntil - now };
}

/** Human-readable remaining lockout, for the message shown on a refused attempt. */
export function formatRemaining(remainingMs: number): string {
	const totalSeconds = Math.ceil(remainingMs / 1000);
	if (totalSeconds < 60) return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
	const minutes = Math.ceil(totalSeconds / 60);
	return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
