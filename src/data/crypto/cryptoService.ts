// Native Web Crypto API only — no cryptography dependency (Constitution Principles II, V).
// PBKDF2-SHA256 (210,000 iterations) derives a 256-bit AES-GCM key from the user's PIN.
// See specs/001-personal-finance-manager/research.md #6 and contracts/repository-interfaces.md.

const PBKDF2_ITERATIONS = 210_000;
const AES_KEY_LENGTH_BITS = 256;
const GCM_IV_LENGTH_BYTES = 12;

export interface EncryptedBlob {
	iv: string; // base64
	ciphertext: string; // base64
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let binary = '';
	for (const byte of arr) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

// TypeScript's DOM lib types `Uint8Array` as generic over `ArrayBufferLike`, which is no
// longer structurally assignable to the `BufferSource` the Web Crypto API expects. The
// runtime value is always a plain ArrayBuffer-backed view; this narrows the type only.
function asBufferSource(bytes: Uint8Array): BufferSource {
	return bytes as unknown as BufferSource;
}

export function generateSalt(): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(16));
}

export function randomSaltBase64(): string {
	return toBase64(generateSalt());
}

async function importPinKeyMaterial(pin: string): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
		'deriveKey',
		'deriveBits'
	]);
}

/**
 * Derives the AES-GCM encryption key used for all financial data, from the user's PIN
 * and a stored per-installation salt. The resulting CryptoKey is never persisted — it is
 * held only in memory for the session (see lib/stores/sessionStore.ts).
 */
export async function deriveEncryptionKey(pin: string, saltBase64: string): Promise<CryptoKey> {
	const keyMaterial = await importPinKeyMaterial(pin);
	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt: asBufferSource(fromBase64(saltBase64)),
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256'
		},
		keyMaterial,
		{ name: 'AES-GCM', length: AES_KEY_LENGTH_BITS },
		false,
		['encrypt', 'decrypt']
	);
}

/**
 * Produces a salted PIN verifier (FR-004): a PBKDF2-derived hash suitable for confirming
 * a PIN is correct, from which the PIN itself cannot be recovered and which is distinct
 * from the encryption key (different salt: `pinSalt` vs. `encryptionSalt`).
 */
export async function hashPin(pin: string, pinSaltBase64: string): Promise<string> {
	const keyMaterial = await importPinKeyMaterial(pin);
	const bits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			salt: asBufferSource(fromBase64(pinSaltBase64)),
			iterations: PBKDF2_ITERATIONS,
			hash: 'SHA-256'
		},
		keyMaterial,
		256
	);
	return toBase64(bits);
}

export async function verifyPin(
	pin: string,
	pinSaltBase64: string,
	expectedHash: string
): Promise<boolean> {
	const candidate = await hashPin(pin, pinSaltBase64);
	return timingSafeEqual(candidate, expectedHash);
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export async function encrypt(key: CryptoKey, plaintext: unknown): Promise<EncryptedBlob> {
	const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_LENGTH_BYTES));
	const encoded = new TextEncoder().encode(JSON.stringify(plaintext));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv: asBufferSource(iv) },
		key,
		asBufferSource(encoded)
	);
	return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

export async function decrypt<T = unknown>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
	const iv = fromBase64(blob.iv);
	const ciphertext = fromBase64(blob.ciphertext);
	const decrypted = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: asBufferSource(iv) },
		key,
		asBufferSource(ciphertext)
	);
	return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}

export async function sha256Hex(data: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export const CryptoService = {
	generateSalt,
	randomSaltBase64,
	deriveEncryptionKey,
	hashPin,
	verifyPin,
	encrypt,
	decrypt,
	sha256Hex,
	PBKDF2_ITERATIONS
};
