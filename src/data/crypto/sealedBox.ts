// "Sealed box" for messages captured while the app is locked.
//
// The Android receivers that catch a bank SMS or notification run with no PIN and no encryption
// key — the key only exists in memory after unlock — so they cannot write to the encrypted
// database. They also must not leave the message readable on disk (Constitution Principle II).
// So: when capture is switched on, this module makes an RSA key pair, the PUBLIC half goes to the
// native side and the PRIVATE half is stored encrypted with the PIN-derived data key. Native code
// can therefore only ever lock messages away; opening them takes the private key, which needs the
// PIN. Each item is hybrid-encrypted: a random AES-256-GCM key encrypts the message, and the
// public key wraps that AES key (RSA-OAEP with SHA-1/MGF1-SHA-1, the one combination Java and
// WebCrypto both default to — SHA-256 differs between the two in the MGF1 hash).
import { encrypt, decrypt } from './cryptoService';
import type { EncryptedBlob } from './cryptoService';

/** What native hands over for each queued message. All binary fields are base64. */
export interface SealedCaptureItem {
	v: 1;
	/** Random id, used to acknowledge the item once it has been filed. */
	id: string;
	/** Which sealing key pair locked it. */
	kid: string;
	/** The AES key, wrapped with the RSA public key. */
	wk: string;
	/** AES-GCM IV (12 bytes). */
	iv: string;
	/** AES-GCM ciphertext followed by the 16-byte tag, as Java's `doFinal` returns it. */
	ct: string;
}

export interface SealingKeyMaterial {
	/** Base64 X.509 SubjectPublicKeyInfo — goes to native. */
	publicKey: string;
	keyId: string;
	/** Base64 PKCS#8 private key, encrypted with the data key — stays in the profile. */
	wrappedPrivateKey: EncryptedBlob;
}

const KEY_PARAMS = {
	name: 'RSA-OAEP',
	modulusLength: 2048,
	publicExponent: new Uint8Array([1, 0, 1]),
	hash: 'SHA-1'
} as const;

function bytesToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
	const binary = atob(b64);
	const bytes = new Uint8Array(new ArrayBuffer(binary.length));
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Makes a new sealing key pair, with the private half encrypted under `dataKey`. */
export async function createSealingKey(dataKey: CryptoKey): Promise<SealingKeyMaterial> {
	const pair = await crypto.subtle.generateKey(KEY_PARAMS, true, ['encrypt', 'decrypt']);
	const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
	const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
	try {
		return {
			publicKey: bytesToBase64(spki),
			keyId: toHex(crypto.getRandomValues(new Uint8Array(8))),
			wrappedPrivateKey: await encrypt(dataKey, bytesToBase64(pkcs8))
		};
	} finally {
		pkcs8.fill(0);
	}
}

/** Opens the stored private key as a non-extractable decrypt-only key. */
export async function loadSealingPrivateKey(
	dataKey: CryptoKey,
	wrapped: EncryptedBlob
): Promise<CryptoKey> {
	const pkcs8 = base64ToBytes(await decrypt<string>(dataKey, wrapped));
	try {
		return await crypto.subtle.importKey(
			'pkcs8',
			pkcs8,
			{ name: 'RSA-OAEP', hash: 'SHA-1' },
			false,
			['decrypt']
		);
	} finally {
		pkcs8.fill(0);
	}
}

/** Opens one item. Throws when it was sealed to a different key pair or was tampered with. */
export async function openSealedItem(
	privateKey: CryptoKey,
	item: SealedCaptureItem
): Promise<unknown> {
	const rawAes = await crypto.subtle.decrypt(
		{ name: 'RSA-OAEP' },
		privateKey,
		base64ToBytes(item.wk)
	);
	const aes = await crypto.subtle.importKey('raw', rawAes, 'AES-GCM', false, ['decrypt']);
	const plain = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: base64ToBytes(item.iv) },
		aes,
		base64ToBytes(item.ct)
	);
	return JSON.parse(new TextDecoder().decode(plain));
}

/**
 * The same sealing the native side performs, in JavaScript. The app never needs it at runtime;
 * tests use it to produce items, and it pins the wire format that the Java implementation must
 * match byte for byte.
 */
export async function sealItem(
	publicKeyBase64: string,
	keyId: string,
	payload: unknown,
	id: string = crypto.randomUUID()
): Promise<SealedCaptureItem> {
	const publicKey = await crypto.subtle.importKey(
		'spki',
		base64ToBytes(publicKeyBase64),
		{ name: 'RSA-OAEP', hash: 'SHA-1' },
		false,
		['encrypt']
	);
	const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
		'encrypt',
		'decrypt'
	]);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		aes,
		new TextEncoder().encode(JSON.stringify(payload))
	);
	const wk = await crypto.subtle.encrypt(
		{ name: 'RSA-OAEP' },
		publicKey,
		await crypto.subtle.exportKey('raw', aes)
	);
	return {
		v: 1,
		id,
		kid: keyId,
		wk: bytesToBase64(new Uint8Array(wk)),
		iv: bytesToBase64(iv),
		ct: bytesToBase64(new Uint8Array(ct))
	};
}
