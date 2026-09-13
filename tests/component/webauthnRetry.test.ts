import { describe, it, expect, vi, afterEach } from 'vitest';
import { enrollBiometric, retryPrfEval } from '../../src/lib/webauthn';

/**
 * Regression: every "Retry" after a `prf-eval-failed` outcome called `enrollBiometric` again,
 * which unconditionally calls `navigator.credentials.create()` — minting a brand-new platform
 * credential even though one already exists and only the PRF assertion (not creation) failed.
 * WebAuthn gives pages no way to delete a credential, so each failed retry left one more
 * unusable entry in the OS/browser credential store. `retryPrfEval` should retry only the
 * assertion, calling `credentials.get` and never `credentials.create` again.
 */
describe('webauthn PRF-eval retry', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubPlatform(opts: { getResult: unknown }) {
		vi.stubGlobal('window', { PublicKeyCredential: function () {} });
		vi.stubGlobal('navigator', {
			credentials: {
				create: vi.fn(async () => ({
					rawId: new Uint8Array([1, 2, 3]).buffer,
					getClientExtensionResults: () => ({ prf: { enabled: true } })
				})),
				get: vi.fn(async () => opts.getResult)
			}
		});
	}

	it('enrollBiometric returns a `pending` handle on prf-eval-failed, without a second credential.create call', async () => {
		// First assertion (inside enrollBiometric) yields no PRF result.
		stubPlatform({ getResult: { getClientExtensionResults: () => ({}) } });
		const createSpy = (navigator as unknown as { credentials: { create: ReturnType<typeof vi.fn> } })
			.credentials.create;

		const result = await enrollBiometric('123456');
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure');
		expect(result.reason).toBe('prf-eval-failed');
		expect(result.pending).toBeDefined();
		expect(createSpy).toHaveBeenCalledTimes(1);
	});

	it('retryPrfEval succeeds without ever calling credentials.create', async () => {
		vi.stubGlobal('window', { PublicKeyCredential: function () {} });
		const createSpy = vi.fn();
		const prfOutput = new Uint8Array(32).buffer;
		vi.stubGlobal('navigator', {
			credentials: {
				create: createSpy,
				get: vi.fn(async () => ({
					getClientExtensionResults: () => ({ prf: { results: { first: prfOutput } } })
				}))
			}
		});

		const pending = { credentialRawId: new Uint8Array([1, 2, 3]).buffer, prfSalt: btoa('abc') };
		const result = await retryPrfEval(pending, '123456');

		expect(result.ok).toBe(true);
		expect(createSpy).not.toHaveBeenCalled();
	});
});
