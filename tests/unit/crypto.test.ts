import { describe, it, expect } from 'vitest';
import {
	hashPin,
	verifyPin,
	deriveEncryptionKey,
	encrypt,
	decrypt,
	randomSaltBase64,
	sha256Hex
} from '../../src/data/crypto/cryptoService';

describe('CryptoService', () => {
	it('hashes a PIN deterministically for the same salt, and verifies it', async () => {
		const salt = randomSaltBase64();
		const hash = await hashPin('1234', salt);
		expect(await verifyPin('1234', salt, hash)).toBe(true);
	});

	it('rejects an incorrect PIN', async () => {
		const salt = randomSaltBase64();
		const hash = await hashPin('1234', salt);
		expect(await verifyPin('9999', salt, hash)).toBe(false);
	});

	it('produces different hashes for the same PIN under different salts', async () => {
		const hashA = await hashPin('1234', randomSaltBase64());
		const hashB = await hashPin('1234', randomSaltBase64());
		expect(hashA).not.toBe(hashB);
	});

	it('derives usable AES-GCM keys from a PIN + salt that round-trip encrypt/decrypt', async () => {
		const salt = randomSaltBase64();
		const key = await deriveEncryptionKey('4242', salt);
		const blob = await encrypt(key, { amount: -50000, note: 'coffee' });
		const decrypted = await decrypt<{ amount: number; note: string }>(key, blob);
		expect(decrypted).toEqual({ amount: -50000, note: 'coffee' });
	});

	it('fails to decrypt with a key derived from a different PIN', async () => {
		const salt = randomSaltBase64();
		const correctKey = await deriveEncryptionKey('4242', salt);
		const wrongKey = await deriveEncryptionKey('0000', salt);
		const blob = await encrypt(correctKey, { secret: true });
		await expect(decrypt(wrongKey, blob)).rejects.toThrow();
	});

	it('never embeds the plaintext PIN in the encrypted blob', async () => {
		const salt = randomSaltBase64();
		const key = await deriveEncryptionKey('135790', salt);
		const blob = await encrypt(key, { pin: '135790', note: 'should not leak' });
		expect(blob.ciphertext).not.toContain('135790');
		expect(JSON.stringify(blob)).not.toContain('should not leak');
	});

	it('sha256Hex produces a stable 64-char hex digest', async () => {
		const digest = await sha256Hex('hello world');
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
		expect(await sha256Hex('hello world')).toBe(digest);
	});
});
