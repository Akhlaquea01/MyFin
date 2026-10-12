// Wrapper over the local Android `NativeBackupFolder` plugin (see
// android/.../backup/NativeBackupFolderPlugin.java). The web build saves scheduled backups through
// the File System Access API, which does not exist inside Android WebView; Android's Storage Access
// Framework does the same job: the user picks a folder once, Android remembers the grant, and each
// scheduled backup becomes a new file in it. Only the already-encrypted backup text goes through.
import { registerPlugin } from '@capacitor/core';
import { isNativePluginAvailable } from './platform';

const PLUGIN_NAME = 'NativeBackupFolder';

export interface NativeBackupFolder {
	/** Opaque `content://` tree address Android gave for the chosen folder. */
	uri: string;
	/** The folder's own name, for showing the user where backups go. */
	name: string;
}

interface NativeBackupFolderPlugin {
	pickFolder(): Promise<NativeBackupFolder>;
	checkAccess(options: { uri: string }): Promise<{ ok: boolean }>;
	writeFile(options: { uri: string; filename: string; base64: string }): Promise<void>;
}

let plugin: NativeBackupFolderPlugin | undefined;
// Registered on first use, like the other native wrappers.
function getPlugin(): NativeBackupFolderPlugin {
	plugin ??= registerPlugin<NativeBackupFolderPlugin>(PLUGIN_NAME);
	return plugin;
}

export function isNativeBackupFolderAvailable(): boolean {
	return isNativePluginAvailable(PLUGIN_NAME);
}

/** Opens Android's folder picker. Rejects with `isFolderPickCancelled` true when the user backs out. */
export function pickNativeBackupFolder(): Promise<NativeBackupFolder> {
	return getPlugin().pickFolder();
}

/** True when the user dismissed the folder picker rather than something going wrong. */
export function isFolderPickCancelled(err: unknown): boolean {
	return (err as { code?: unknown } | null)?.code === 'cancelled';
}

/** Whether Android still lets MyFin write to the chosen folder (the user can revoke it). */
export async function nativeBackupFolderHasAccess(uri: string): Promise<boolean> {
	try {
		return (await getPlugin().checkAccess({ uri })).ok;
	} catch {
		return false;
	}
}

const BASE64_CHUNK_BYTES = 0x8000;

/** UTF-8 text to base64 — chunked so a multi-megabyte backup cannot overflow `fromCharCode`'s arguments. */
export function utf8ToBase64(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = '';
	for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
		binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_BYTES));
	}
	return btoa(binary);
}

/** Creates `filename` in the chosen folder holding `text`. Rejects if it could not be written completely. */
export function writeNativeBackupFile(
	folder: NativeBackupFolder,
	filename: string,
	text: string
): Promise<void> {
	return getPlugin().writeFile({ uri: folder.uri, filename, base64: utf8ToBase64(text) });
}
