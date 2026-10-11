import { describe, it, expect } from 'vitest';
import { unwrapPin, wrapPin } from '../../src/lib/pinWrap';

function randomSecret(): string {
	return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}

describe('pinWrap', () => {
	it('round-trips a PIN through a secret', async () => {
		const secret = randomSecret();
		const blob = await wrapPin(secret, '482915');
		expect(await unwrapPin(secret, blob)).toBe('482915');
	});

	it('never stores the PIN in the clear', async () => {
		const blob = await wrapPin(randomSecret(), '482915');
		expect(JSON.stringify(blob)).not.toContain('482915');
		expect(btoa('482915')).not.toBe(blob.ciphertext);
	});

	it('refuses to open with a different secret, which is how a stale enrollment shows up', async () => {
		const blob = await wrapPin(randomSecret(), '482915');
		await expect(unwrapPin(randomSecret(), blob)).rejects.toBeDefined();
	});

	it('uses a fresh IV each time', async () => {
		const secret = randomSecret();
		const a = await wrapPin(secret, '482915');
		const b = await wrapPin(secret, '482915');
		expect(a.iv).not.toBe(b.iv);
	});
});
