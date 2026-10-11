import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/lib/native/nativeBiometric', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/lib/native/nativeBiometric')>()),
	isNativeBiometricAvailable: vi.fn(),
	getNativeBiometricStatus: vi.fn(),
	enrollNativeBiometric: vi.fn(),
	authenticateNativeBiometric: vi.fn(),
	clearNativeBiometric: vi.fn()
}));

import {
	describeBiometricReason,
	enrollBiometricUnlock,
	getBiometricAvailability,
	getBiometricProvider,
	isBiometricEnrolled,
	unlockWithBiometric,
	type BiometricReason
} from '../../src/lib/biometric';
import * as native from '../../src/lib/native/nativeBiometric';
import { NativeBiometricError } from '../../src/lib/native/nativeBiometric';
import { wrapPin } from '../../src/lib/pinWrap';
import type { UserProfile } from '../../src/domain/entities';

const PIN = '482915';
const randomSecret = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

function profileWith(extra: Partial<UserProfile> = {}): UserProfile {
	return {
		id: 'local-user',
		pinVerifierHash: 'h',
		pinSalt: 's',
		encryptionSalt: 'e',
		biometricEnabled: true,
		autoLockTimeoutMs: 300_000,
		storagePersisted: true,
		...extra
	};
}

const ALL_REASONS: BiometricReason[] = [
	'no-hardware',
	'hw-unavailable',
	'none-enrolled',
	'security-update-required',
	'unsupported',
	'cancelled',
	'lockout',
	'lockout-permanent',
	'timeout',
	'invalidated',
	'not-enrolled',
	'not-ready',
	'busy',
	'error',
	'no-prf',
	'prf-eval-failed',
	'stale'
];

describe('biometric service', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('provider selection', () => {
		it('uses the native plugin inside the Android app', () => {
			vi.mocked(native.isNativeBiometricAvailable).mockReturnValue(true);
			expect(getBiometricProvider()).toBe('native');
		});

		it('uses WebAuthn in a browser that has it', () => {
			vi.mocked(native.isNativeBiometricAvailable).mockReturnValue(false);
			vi.stubGlobal('window', { PublicKeyCredential: class {} });
			expect(getBiometricProvider()).toBe('webauthn');
		});

		it('offers nothing when neither exists', async () => {
			vi.mocked(native.isNativeBiometricAvailable).mockReturnValue(false);
			vi.stubGlobal('window', {});
			expect(getBiometricProvider()).toBe('none');
			expect(await getBiometricAvailability()).toEqual({
				provider: 'none',
				available: false,
				reason: 'unsupported'
			});
		});

		it('reports the exact native reason a sensor cannot be used', async () => {
			vi.mocked(native.isNativeBiometricAvailable).mockReturnValue(true);
			vi.mocked(native.getNativeBiometricStatus).mockResolvedValue({
				available: false,
				reason: 'none-enrolled',
				enrolled: false,
				invalidated: false
			});
			expect(await getBiometricAvailability()).toMatchObject({
				provider: 'native',
				available: false,
				reason: 'none-enrolled'
			});
		});
	});

	describe('describeBiometricReason', () => {
		it('gives every reason a distinct, non-empty explanation', () => {
			const texts = ALL_REASONS.map(describeBiometricReason);
			for (const text of texts) expect(text.length).toBeGreaterThan(10);
			expect(new Set(texts).size).toBe(texts.length);
		});
	});

	describe('native enrollment', () => {
		beforeEach(() => {
			vi.mocked(native.isNativeBiometricAvailable).mockReturnValue(true);
		});

		it('wraps the PIN with the native secret and never puts it in the profile patch in the clear', async () => {
			vi.mocked(native.enrollNativeBiometric).mockResolvedValue(randomSecret());
			const result = await enrollBiometricUnlock(PIN);
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.profilePatch.biometricEnabled).toBe(true);
			expect(result.profilePatch.nativeBiometric?.wrappedPin).toBeDefined();
			expect(JSON.stringify(result.profilePatch)).not.toContain(PIN);
		});

		it('reports why it failed and cleans up the half-made key', async () => {
			vi.mocked(native.enrollNativeBiometric).mockRejectedValue(
				new NativeBiometricError('none-enrolled', 'x')
			);
			const result = await enrollBiometricUnlock(PIN);
			expect(result).toEqual({ ok: false, reason: 'none-enrolled' });
			expect(native.clearNativeBiometric).toHaveBeenCalled();
		});
	});

	describe('native unlock', () => {
		beforeEach(() => {
			vi.mocked(native.isNativeBiometricAvailable).mockReturnValue(true);
		});

		it('recovers the PIN after a successful fingerprint', async () => {
			const secret = randomSecret();
			const profile = profileWith({
				nativeBiometric: { wrappedPin: await wrapPin(secret, PIN), enrolledAt: 1 }
			});
			vi.mocked(native.authenticateNativeBiometric).mockResolvedValue(secret);
			expect(await unlockWithBiometric(profile)).toEqual({ ok: true, pin: PIN });
		});

		it('treats a wrapped PIN that no longer opens as stale and asks to clear it', async () => {
			const profile = profileWith({
				nativeBiometric: { wrappedPin: await wrapPin(randomSecret(), PIN), enrolledAt: 1 }
			});
			vi.mocked(native.authenticateNativeBiometric).mockResolvedValue(randomSecret());
			expect(await unlockWithBiometric(profile)).toEqual({
				ok: false,
				reason: 'stale',
				clearEnrollment: true
			});
		});

		it('asks to clear the enrollment when the fingerprints on the phone changed', async () => {
			const profile = profileWith({
				nativeBiometric: { wrappedPin: await wrapPin(randomSecret(), PIN), enrolledAt: 1 }
			});
			vi.mocked(native.authenticateNativeBiometric).mockRejectedValue(
				new NativeBiometricError('invalidated', 'x')
			);
			expect(await unlockWithBiometric(profile)).toEqual({
				ok: false,
				reason: 'invalidated',
				clearEnrollment: true
			});
		});

		it('keeps the enrollment when the user just cancels', async () => {
			const profile = profileWith({
				nativeBiometric: { wrappedPin: await wrapPin(randomSecret(), PIN), enrolledAt: 1 }
			});
			vi.mocked(native.authenticateNativeBiometric).mockRejectedValue(
				new NativeBiometricError('cancelled', 'x')
			);
			expect(await unlockWithBiometric(profile)).toEqual({
				ok: false,
				reason: 'cancelled',
				clearEnrollment: false
			});
		});

		it('is not enrolled without a stored wrapped PIN', async () => {
			expect(await unlockWithBiometric(profileWith())).toEqual({
				ok: false,
				reason: 'not-enrolled'
			});
		});
	});

	describe('isBiometricEnrolled', () => {
		beforeEach(() => {
			vi.mocked(native.isNativeBiometricAvailable).mockReturnValue(true);
		});
		const withNative = () =>
			profileWith({ nativeBiometric: { wrappedPin: { iv: 'a', ciphertext: 'b' }, enrolledAt: 1 } });

		it('needs both the profile record and a live native key', async () => {
			vi.mocked(native.getNativeBiometricStatus).mockResolvedValue({
				available: true,
				enrolled: true,
				invalidated: false
			});
			expect(await isBiometricEnrolled(withNative())).toBe(true);
			expect(await isBiometricEnrolled(profileWith())).toBe(false);
			expect(await isBiometricEnrolled(null)).toBe(false);
		});

		it('is false once the native key was invalidated', async () => {
			vi.mocked(native.getNativeBiometricStatus).mockResolvedValue({
				available: true,
				enrolled: true,
				invalidated: true
			});
			expect(await isBiometricEnrolled(withNative())).toBe(false);
		});
	});

	it('never writes to the console while handling secrets', async () => {
		const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
			vi.spyOn(console, m).mockImplementation(() => {})
		);
		vi.mocked(native.isNativeBiometricAvailable).mockReturnValue(true);
		vi.mocked(native.enrollNativeBiometric).mockResolvedValue(randomSecret());
		await enrollBiometricUnlock(PIN);
		for (const spy of spies) expect(spy).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});
});
