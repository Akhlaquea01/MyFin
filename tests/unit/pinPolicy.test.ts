import { describe, it, expect } from 'vitest';
import {
	validatePin,
	nextLockoutMs,
	unlockGate,
	formatRemaining,
	MIN_PIN_LENGTH,
	MAX_PIN_LENGTH,
	FREE_UNLOCK_ATTEMPTS,
	MAX_LOCKOUT_MS
} from '../../src/domain/auth/pinPolicy';

describe('validatePin', () => {
	it('accepts a reasonable PIN', () => {
		expect(validatePin('482915')).toEqual({ ok: true });
		expect(validatePin('9174036')).toEqual({ ok: true });
	});

	it('enforces the length floor and ceiling', () => {
		expect(validatePin('1234')).toMatchObject({ ok: false, reason: 'length' });
		expect(validatePin('48291')).toMatchObject({ ok: false, reason: 'length' });
		expect(validatePin('4'.repeat(MAX_PIN_LENGTH + 1))).toMatchObject({
			ok: false,
			reason: 'length'
		});
		expect(validatePin('482915'.padEnd(MIN_PIN_LENGTH, '0')).ok).toBe(true);
	});

	it('rejects non-digits', () => {
		expect(validatePin('abcdef')).toMatchObject({ ok: false, reason: 'non-digit' });
		expect(validatePin('4829 15')).toMatchObject({ ok: false, reason: 'non-digit' });
		expect(validatePin('')).toMatchObject({ ok: false, reason: 'non-digit' });
	});

	it('rejects a single repeated digit', () => {
		expect(validatePin('444444')).toMatchObject({ ok: false, reason: 'repeated' });
		expect(validatePin('00000000')).toMatchObject({ ok: false, reason: 'repeated' });
	});

	it('rejects consecutive runs in both directions', () => {
		expect(validatePin('123456')).toMatchObject({ ok: false });
		expect(validatePin('654321')).toMatchObject({ ok: false });
		expect(validatePin('345678')).toMatchObject({ ok: false, reason: 'sequential' });
		// ...but not a PIN that merely contains a short run
		expect(validatePin('123579').ok).toBe(true);
	});

	it('rejects well-known common PINs', () => {
		expect(validatePin('121212')).toMatchObject({ ok: false, reason: 'common' });
		expect(validatePin('696969')).toMatchObject({ ok: false, reason: 'common' });
	});

	it('always supplies a message when it rejects', () => {
		for (const bad of ['1234', 'abcdef', '111111', '123456', '121212']) {
			const result = validatePin(bad);
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.message.length).toBeGreaterThan(0);
		}
	});
});

describe('nextLockoutMs', () => {
	it('does not punish honest typos within the free allowance', () => {
		for (let n = 0; n <= FREE_UNLOCK_ATTEMPTS; n++) {
			expect(nextLockoutMs(n)).toBe(0);
		}
	});

	it('doubles from one second once the allowance is spent', () => {
		expect(nextLockoutMs(FREE_UNLOCK_ATTEMPTS + 1)).toBe(1_000);
		expect(nextLockoutMs(FREE_UNLOCK_ATTEMPTS + 2)).toBe(2_000);
		expect(nextLockoutMs(FREE_UNLOCK_ATTEMPTS + 3)).toBe(4_000);
		expect(nextLockoutMs(FREE_UNLOCK_ATTEMPTS + 4)).toBe(8_000);
	});

	it('caps rather than escalating forever, and never overflows', () => {
		expect(nextLockoutMs(50)).toBe(MAX_LOCKOUT_MS);
		expect(nextLockoutMs(1_000)).toBe(MAX_LOCKOUT_MS);
		expect(Number.isFinite(nextLockoutMs(Number.MAX_SAFE_INTEGER))).toBe(true);
	});

	it('makes exhaustive online guessing of a 6-digit PIN infeasible', () => {
		// The point of the throttle: reaching even 20 attempts already costs minutes, so the
		// 10^6 space cannot be walked through the UI.
		let elapsed = 0;
		for (let n = 1; n <= 20; n++) elapsed += nextLockoutMs(n);
		expect(elapsed).toBeGreaterThan(60_000);
	});
});

describe('unlockGate', () => {
	it('allows when there is no active lockout', () => {
		expect(unlockGate(null, 1_000)).toEqual({ allowed: true });
	});

	it('allows once the lockout has elapsed', () => {
		expect(unlockGate(1_000, 1_000)).toEqual({ allowed: true });
		expect(unlockGate(1_000, 5_000)).toEqual({ allowed: true });
	});

	it('refuses while locked out and reports the remaining time', () => {
		expect(unlockGate(5_000, 1_500)).toEqual({ allowed: false, remainingMs: 3_500 });
	});
});

describe('formatRemaining', () => {
	it('reads naturally in both units', () => {
		expect(formatRemaining(1)).toBe('1 second');
		expect(formatRemaining(1_000)).toBe('1 second');
		expect(formatRemaining(3_500)).toBe('4 seconds');
		expect(formatRemaining(60_000)).toBe('1 minute');
		expect(formatRemaining(150_000)).toBe('3 minutes');
	});
});
