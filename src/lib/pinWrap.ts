// Wraps the PIN with a secret released only after a successful native biometric check. The
// secret is imported as a non-extractable AES-GCM key and the byte copy is zeroed, so it lives
// in JS no longer than the single encrypt/decrypt call it serves.
import { encrypt, decrypt } from '../data/crypto/cryptoService';
import type { EncryptedBlob } from '../data/crypto/cryptoService';

async function importSecret(secretBase64: string): Promise<CryptoKey> {
	const bytes = Uint8Array.from(atob(secretBase64), (c) => c.charCodeAt(0));
	try {
		return await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
	} finally {
		bytes.fill(0);
	}
}

export async function wrapPin(secretBase64: string, pin: string): Promise<EncryptedBlob> {
	return encrypt(await importSecret(secretBase64), pin);
}

/** Throws when the blob was not produced with this secret (e.g. a profile restored from a backup). */
export async function unwrapPin(secretBase64: string, blob: EncryptedBlob): Promise<string> {
	return decrypt<string>(await importSecret(secretBase64), blob);
}
