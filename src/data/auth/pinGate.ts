// Re-entering the PIN inside the unlocked app (creating a backup, turning fingerprint unlock on,
// changing the PIN) is an online guessing surface too: it shares the lock screen's failed-attempt
// counter, so it cannot be used to guess the PIN without the throttle that guards the lock screen.
import { UserProfileRepository } from '../dexie/userProfileRepository';
import { verifyPin } from '../crypto/cryptoService';
import { formatRemaining, nextLockoutMs, unlockGate } from '../../domain/auth/pinPolicy';
import type { UserProfile } from '../../domain/entities';

export type PinCheckResult =
	| { ok: true; profile: UserProfile }
	| { ok: false; reason: 'incorrect' | 'locked-out' | 'no-profile'; message: string };

/**
 * Checks `pin` against the stored verifier. A wrong PIN counts toward the same lockout the lock
 * screen uses; a correct one clears the counter.
 */
export async function checkPinWithThrottle(pin: string): Promise<PinCheckResult> {
	const profile = await UserProfileRepository.get();
	if (!profile) return { ok: false, reason: 'no-profile', message: 'No profile found.' };

	const gate = unlockGate(profile.lockedOutUntil ?? null, Date.now());
	if (!gate.allowed) {
		return {
			ok: false,
			reason: 'locked-out',
			message: `Too many attempts. Try again in ${formatRemaining(gate.remainingMs)}.`
		};
	}

	if (await verifyPin(pin, profile.pinSalt, profile.pinVerifierHash)) {
		if ((profile.failedUnlockAttempts ?? 0) > 0 || profile.lockedOutUntil) {
			const cleared = await UserProfileRepository.update({
				failedUnlockAttempts: 0,
				lockedOutUntil: null
			});
			return { ok: true, profile: cleared };
		}
		return { ok: true, profile };
	}

	const failedUnlockAttempts = (profile.failedUnlockAttempts ?? 0) + 1;
	const lockoutMs = nextLockoutMs(failedUnlockAttempts);
	await UserProfileRepository.update({
		failedUnlockAttempts,
		lockedOutUntil: lockoutMs > 0 ? Date.now() + lockoutMs : null
	});
	return {
		ok: false,
		reason: 'incorrect',
		message:
			lockoutMs > 0
				? `Incorrect PIN. Too many attempts — try again in ${formatRemaining(lockoutMs)}.`
				: 'Incorrect PIN.'
	};
}
