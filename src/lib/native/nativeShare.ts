// Wrapper over the local Android `NativeShare` plugin (see android/.../share/NativeSharePlugin.java).
// It receives what other apps share into MyFin through Android's share sheet. The PWA does this
// with a service worker (public/sw-share-target.js), which does not exist inside the Android app.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNativePluginAvailable } from './platform';

const PLUGIN_NAME = 'NativeShare';

export interface NativeSharePayload {
	/** The shared text (for example a bank SMS). */
	text?: string;
	/** The subject line some apps send alongside, used when there is no text. */
	subject?: string;
	/** A shared image, base64-encoded. */
	image?: { name: string; mimeType: string; base64: string };
	/** Set instead of `image` when an image was shared but could not be taken. */
	imageProblem?: 'too-large' | 'unreadable';
}

interface NativeSharePlugin {
	consume(): Promise<{ pending: boolean; payload?: NativeSharePayload }>;
	addListener(eventName: 'shared', listener: () => void): Promise<PluginListenerHandle>;
}

let plugin: NativeSharePlugin | undefined;
// Registered on first use, like the other native wrappers.
function getPlugin(): NativeSharePlugin {
	plugin ??= registerPlugin<NativeSharePlugin>(PLUGIN_NAME);
	return plugin;
}

export function isNativeShareAvailable(): boolean {
	return isNativePluginAvailable(PLUGIN_NAME);
}

/** Takes the waiting share, once. `null` when nothing was shared. */
export async function consumeNativeShare(): Promise<NativeSharePayload | null> {
	const result = await getPlugin().consume();
	return result.pending && result.payload ? result.payload : null;
}

/** Calls back when a new share arrives while the app is already running. */
export function onNativeShare(listener: () => void): Promise<PluginListenerHandle> {
	return getPlugin().addListener('shared', listener);
}
