// Optional biometric convenience layer on top of the mandatory PIN (spec.md Assumptions,
// FR-002). Uses the WebAuthn PRF extension to derive a symmetric key from the platform
// authenticator, which wraps (encrypts) the user's PIN — a successful biometric assertion
// can then recover the PIN and proceed through the normal PIN → encryption-key derivation,
// so biometric is an alternate *entry path* to the same key, never a bypass of it. Falls
// back to unavailable when the browser/authenticator doesn't support the PRF extension.
import { encrypt, decrypt, randomSaltBase64 } from '../data/crypto/cryptoService';
import type { EncryptedBlob } from '../data/crypto/cryptoService';

const RP_NAME = 'Personal Finance Manager';

function toBuffer(base64url: string): Uint8Array {
	const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function toBase64Url(bytes: ArrayBuffer): string {
	const arr = new Uint8Array(bytes);
	let binary = '';
	for (const byte of arr) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isWebAuthnSupported(): boolean {
	return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}

async function derivePrfKey(prfOutput: ArrayBuffer): Promise<CryptoKey> {
	const material = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(0),
			info: new TextEncoder().encode('myfin-webauthn-pin-wrap')
		},
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

export interface WebAuthnEnrollment {
	credentialId: string;
	prfSalt: string;
	wrappedPin: EncryptedBlob;
}

/**
 * Why enrollment didn't produce a usable credential (spec 009) — surfaced so the UI can
 * tell "your browser doesn't do WebAuthn at all" apart from "your fingerprint sensor doesn't
 * support the PRF extension we need to derive a key from it," rather than one flat failure.
 */
export type BiometricUnavailableReason =
	| 'unsupported' // navigator.credentials / PublicKeyCredential not present at all
	| 'cancelled' // user dismissed the OS biometric/security-key prompt
	| 'no-prf' // authenticator created a credential but doesn't support the PRF extension
	| 'prf-eval-failed' // PRF was reported enabled but the eval assertion still didn't yield output
	| 'error'; // anything else (unexpected exception from the platform)

export type BiometricEnrollResult =
	{ ok: true; enrollment: WebAuthnEnrollment } | { ok: false; reason: BiometricUnavailableReason };

/**
 * Enrolls a platform authenticator and wraps `pin` with a PRF-derived key. Real biometric-bound
 * encryption is only possible when the platform authenticator supports the WebAuthn PRF
 * extension — support for it is still inconsistent across Android/Chrome and Windows Hello, so
 * this reports *why* it couldn't proceed rather than a single opaque failure.
 */
export async function enrollBiometric(pin: string): Promise<BiometricEnrollResult> {
	if (!isWebAuthnSupported()) return { ok: false, reason: 'unsupported' };

	const userId = crypto.getRandomValues(new Uint8Array(16));
	const prfSalt = randomSaltBase64();

	let credential: PublicKeyCredential | null;
	try {
		credential = (await navigator.credentials.create({
			publicKey: {
				rp: { name: RP_NAME },
				user: { id: userId, name: 'local-user', displayName: 'Local User' },
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				pubKeyCredParams: [
					{ type: 'public-key', alg: -7 },
					{ type: 'public-key', alg: -257 }
				],
				authenticatorSelection: {
					authenticatorAttachment: 'platform',
					userVerification: 'required'
				},
				extensions: { prf: {} }
			}
		})) as PublicKeyCredential | null;
	} catch (err) {
		const isCancelled = err instanceof DOMException && err.name === 'NotAllowedError';
		return { ok: false, reason: isCancelled ? 'cancelled' : 'error' };
	}
	if (!credential) return { ok: false, reason: 'error' };

	const prfEnabled = (credential.getClientExtensionResults() as { prf?: { enabled?: boolean } }).prf
		?.enabled;
	if (!prfEnabled) return { ok: false, reason: 'no-prf' };

	const prfOutput = await evalPrf(credential.rawId, prfSalt);
	if (!prfOutput) return { ok: false, reason: 'prf-eval-failed' };

	const key = await derivePrfKey(prfOutput);
	const wrappedPin = await encrypt(key, pin);

	return {
		ok: true,
		enrollment: { credentialId: toBase64Url(credential.rawId), prfSalt, wrappedPin }
	};
}

async function evalPrf(
	credentialRawId: ArrayBuffer | Uint8Array,
	prfSaltBase64: string
): Promise<ArrayBuffer | null> {
	const saltBytes = Uint8Array.from(atob(prfSaltBase64), (c) => c.charCodeAt(0));
	const assertion = (await navigator.credentials.get({
		publicKey: {
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			allowCredentials: [{ id: credentialRawId as ArrayBuffer, type: 'public-key' }],
			userVerification: 'required',
			extensions: { prf: { eval: { first: saltBytes } } }
		}
	})) as PublicKeyCredential | null;

	if (!assertion) return null;
	const results = assertion.getClientExtensionResults() as {
		prf?: { results?: { first?: ArrayBuffer } };
	};
	return results.prf?.results?.first ?? null;
}

/** Returns the original PIN on a successful biometric assertion, or `null` if it fails/is unavailable. */
export async function unlockPinWithBiometric(enrollment: {
	credentialId: string;
	prfSalt: string;
	wrappedPin: EncryptedBlob;
}): Promise<string | null> {
	if (!isWebAuthnSupported()) return null;
	try {
		const prfOutput = await evalPrf(toBuffer(enrollment.credentialId), enrollment.prfSalt);
		if (!prfOutput) return null;
		const key = await derivePrfKey(prfOutput);
		return await decrypt<string>(key, enrollment.wrappedPin);
	} catch {
		return null; // Assertion cancelled/failed — caller falls back to manual PIN entry.
	}
}
