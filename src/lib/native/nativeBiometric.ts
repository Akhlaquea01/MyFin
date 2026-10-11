// Thin wrapper over the local Android `NativeBiometric` plugin (see
// android/.../biometric/NativeBiometricPlugin.java). WebAuthn is unavailable inside Android
// WebView, so the APK uses BiometricPrompt backed by a biometric-bound Keystore key. The plugin
// hands back a random secret that `pinWrap.ts` uses to wrap the PIN; the PIN itself never reaches
// native code.
import { registerPlugin } from '@capacitor/core';
import { isNativePluginAvailable } from './platform';

const PLUGIN_NAME = 'NativeBiometric';

export type NativeAvailabilityReason =
	'no-hardware' | 'hw-unavailable' | 'none-enrolled' | 'security-update-required' | 'unsupported';

export type NativeOpReason =
	| 'cancelled'
	| 'lockout'
	| 'lockout-permanent'
	| 'timeout'
	| 'invalidated'
	| 'not-enrolled'
	| 'not-ready'
	| 'busy'
	| 'no-hardware'
	| 'hw-unavailable'
	| 'none-enrolled'
	| 'error';

export interface NativeBiometricStatus {
	available: boolean;
	reason?: NativeAvailabilityReason;
	/** A secret is stored natively. */
	enrolled: boolean;
	/** The stored key was invalidated (new fingerprint added, lock screen removed). */
	invalidated: boolean;
}

export interface NativePromptOptions {
	title: string;
	subtitle?: string;
	cancelLabel: string;
}

interface NativeBiometricPlugin {
	getStatus(): Promise<NativeBiometricStatus>;
	enroll(options: NativePromptOptions): Promise<{ secret: string }>;
	authenticate(options: NativePromptOptions): Promise<{ secret: string }>;
	clear(): Promise<void>;
}

/** A rejected native call, with the plugin's machine-readable reason. */
export class NativeBiometricError extends Error {
	reason: NativeOpReason;
	constructor(reason: NativeOpReason, message: string) {
		super(message);
		this.name = 'NativeBiometricError';
		this.reason = reason;
	}
}

let plugin: NativeBiometricPlugin | undefined;
// Registered on first use, not at import: modules that merely import this file (and tests that
// mock `@capacitor/core` without `registerPlugin`) must not touch the bridge.
function getPlugin(): NativeBiometricPlugin {
	plugin ??= registerPlugin<NativeBiometricPlugin>(PLUGIN_NAME);
	return plugin;
}

function toError(err: unknown): NativeBiometricError {
	const e = err as { code?: unknown; message?: unknown } | null;
	const code = typeof e?.code === 'string' ? (e.code as NativeOpReason) : 'error';
	const message = typeof e?.message === 'string' ? e.message : 'Fingerprint request failed.';
	return new NativeBiometricError(code, message);
}

export function isNativeBiometricAvailable(): boolean {
	return isNativePluginAvailable(PLUGIN_NAME);
}

export async function getNativeBiometricStatus(): Promise<NativeBiometricStatus> {
	try {
		return await getPlugin().getStatus();
	} catch (err) {
		throw toError(err);
	}
}

/** Creates the biometric-bound key, shows the prompt, and resolves the new secret (base64). */
export async function enrollNativeBiometric(options: NativePromptOptions): Promise<string> {
	try {
		return (await getPlugin().enroll(options)).secret;
	} catch (err) {
		throw toError(err);
	}
}

let inFlightAuthentication: Promise<string> | null = null;

/**
 * Shows the prompt and resolves the stored secret (base64). Concurrent callers share one prompt:
 * React StrictMode runs effects twice in development, and a second prompt would be rejected as
 * `busy` while the first is still on screen.
 */
export function authenticateNativeBiometric(options: NativePromptOptions): Promise<string> {
	if (inFlightAuthentication) return inFlightAuthentication;
	const attempt = getPlugin()
		.authenticate(options)
		.then((result) => result.secret)
		.catch((err: unknown) => {
			throw toError(err);
		})
		.finally(() => {
			inFlightAuthentication = null;
		});
	inFlightAuthentication = attempt;
	return attempt;
}

export async function clearNativeBiometric(): Promise<void> {
	try {
		await getPlugin().clear();
	} catch {
		// Nothing useful to do: the profile flag is cleared separately, which disables the path.
	}
}
