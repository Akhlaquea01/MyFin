// Wrapper over the local Android `NativeAppUpdate` plugin (see
// android/.../update/NativeAppUpdatePlugin.java). The Android app updates itself from MyFin's
// GitHub Releases: check, download, hand the APK to Android's installer. The network lives in the
// plugin, not here — the WebView's Content-Security-Policy keeps `connect-src 'self'` — and this
// side never supplies an address, so nothing running in the page can steer what gets installed.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNativePluginAvailable } from './platform';

const PLUGIN_NAME = 'NativeAppUpdate';

export interface NativeUpdateCheck {
	/** The installed app's version name, as Android reports it. */
	installedVersion: string;
	/** The newest published version (`x.y.z`). */
	latestVersion: string;
	updateAvailable: boolean;
	/** Size of the APK in bytes; 0 when no update is available. */
	size: number;
	/** The release notes (commit subjects), plain text. */
	notes: string;
	/** ISO timestamp the release was published, or empty. */
	publishedAt: string;
}

export type NativeInstallStatus = 'started' | 'permission-needed';

interface NativeAppUpdatePlugin {
	check(): Promise<NativeUpdateCheck>;
	download(): Promise<{ version: string }>;
	install(): Promise<{ status: NativeInstallStatus }>;
	addListener(
		eventName: 'progress',
		listener: (progress: { received: number; total: number }) => void
	): Promise<PluginListenerHandle>;
}

let plugin: NativeAppUpdatePlugin | undefined;
// Registered on first use, like the other native wrappers.
function getPlugin(): NativeAppUpdatePlugin {
	plugin ??= registerPlugin<NativeAppUpdatePlugin>(PLUGIN_NAME);
	return plugin;
}

export function isNativeAppUpdateAvailable(): boolean {
	return isNativePluginAvailable(PLUGIN_NAME);
}

/** Asks GitHub for the newest release and compares it with the installed version. */
export function checkForNativeUpdate(): Promise<NativeUpdateCheck> {
	return getPlugin().check();
}

/**
 * Downloads the update that `checkForNativeUpdate` found and verifies it. `onProgress` is called
 * as bytes arrive (`total` is 0 when the size is unknown).
 */
export async function downloadNativeUpdate(
	onProgress: (received: number, total: number) => void
): Promise<void> {
	const handle = await getPlugin().addListener('progress', (p) => onProgress(p.received, p.total));
	try {
		await getPlugin().download();
	} finally {
		await handle.remove();
	}
}

/**
 * Opens Android's installer on the downloaded file. `permission-needed` means Android's
 * "Install unknown apps" screen for MyFin was opened instead: the user allows it, comes back and
 * asks again.
 */
export async function installNativeUpdate(): Promise<NativeInstallStatus> {
	return (await getPlugin().install()).status;
}

const ERROR_MESSAGES: Record<string, string> = {
	offline: 'Could not reach GitHub. Check your connection and try again.',
	'no-release': 'No update has been published yet.',
	'rate-limited': 'GitHub is limiting requests right now. Try again in a little while.',
	'bad-response': 'GitHub’s answer could not be read. Try again later.',
	'no-asset': 'The newest release has no app file yet. Try again in a few minutes.',
	busy: 'An update step is already running. Wait a moment and try again.',
	'not-checked': 'Check for updates first.',
	'download-failed': 'The download failed. Try again.',
	checksum: 'The downloaded file was damaged, so it was discarded. Try again.',
	'wrong-app': 'The downloaded file is not a MyFin update, so it was discarded.',
	'not-newer': 'The downloaded file is not newer than the installed app, so it was discarded.',
	signature:
		'The update is signed with a different key, so Android would refuse it over this install. Install it by hand from the release page instead.',
	'not-downloaded': 'Download the update first.',
	'install-failed':
		'Android could not open the installer. Try again, or open the downloaded file from the Files app.'
};

/** A message to show the user for whatever the plugin rejected with. */
export function describeUpdateError(err: unknown): string {
	const code = (err as { code?: unknown } | null)?.code;
	return (
		(typeof code === 'string' && Object.hasOwn(ERROR_MESSAGES, code)
			? ERROR_MESSAGES[code]
			: undefined) ?? 'Something went wrong while updating. Try again.'
	);
}
