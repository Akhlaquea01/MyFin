// One place that knows how to show a notification. In the Android app that means a real Android
// notification through the Capacitor LocalNotifications plugin (the browser's Notification API
// does not exist inside Android WebView, which is why reminders never appeared there); in a
// browser or installed PWA it is the Notification API, exactly as before.
//
// Only ever used for notifications shown right away, from content that is already in memory
// after unlock — nothing financial is handed to an OS scheduler to be stored and fired later.
import { isNativeApp } from './native/platform';

/** `default` = not asked yet; `unsupported` = this environment cannot show notifications at all. */
export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported';

const CHANNEL_ID = 'reminders';
/** Android's "private" lock-screen visibility: shown, but with content hidden until unlocked. */
const VISIBILITY_PRIVATE = 0;
const IMPORTANCE_DEFAULT = 3;

type LocalNotificationsPlugin = typeof import('@capacitor/local-notifications').LocalNotifications;

let pluginPromise: Promise<LocalNotificationsPlugin> | undefined;
// Loaded on first use so the web bundle and tests that never touch native do not pull it in.
function nativePlugin(): Promise<LocalNotificationsPlugin> {
	pluginPromise ??= import('@capacitor/local-notifications').then((m) => m.LocalNotifications);
	return pluginPromise;
}

let channelReady: Promise<void> | undefined;
function ensureChannel(): Promise<void> {
	channelReady ??= nativePlugin()
		.then((plugin) =>
			plugin.createChannel({
				id: CHANNEL_ID,
				name: 'Bill and budget reminders',
				description: 'Upcoming recurring bills, budget limits and overdue loans.',
				importance: IMPORTANCE_DEFAULT,
				visibility: VISIBILITY_PRIVATE
			})
		)
		.catch((err) => {
			// Try again next time rather than caching a failure.
			channelReady = undefined;
			throw err;
		});
	return channelReady;
}

/** A stable positive 31-bit id for a notification key, so the same reminder replaces itself
 *  instead of stacking. (FNV-1a; Android notification ids are 32-bit ints.) */
export function notificationId(tag: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < tag.length; i++) {
		hash ^= tag.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash & 0x7fffffff;
}

function fromNative(state: string): NotifyPermission {
	if (state === 'granted') return 'granted';
	if (state === 'denied') return 'denied';
	return 'default';
}

export async function getNotifyPermission(): Promise<NotifyPermission> {
	if (isNativeApp()) {
		try {
			return fromNative((await (await nativePlugin()).checkPermissions()).display);
		} catch {
			return 'unsupported';
		}
	}
	if (typeof Notification === 'undefined') return 'unsupported';
	return Notification.permission;
}

/** Asks the user. In the browser this is the permission prompt; on Android 13+ the system dialog
 *  (earlier versions grant it without one). */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
	if (isNativeApp()) {
		try {
			return fromNative((await (await nativePlugin()).requestPermissions()).display);
		} catch {
			return 'unsupported';
		}
	}
	if (typeof Notification === 'undefined') return 'unsupported';
	return Notification.requestPermission();
}

/**
 * Shows a notification now. Resolves whether it was handed to the system — `false` (never a throw)
 * when it could not be, so a caller can leave the reminder eligible for the next check.
 * `tag` identifies the reminder: a repeat with the same tag replaces the earlier one.
 */
export async function showNotification(title: string, body: string, tag: string): Promise<boolean> {
	try {
		if (isNativeApp()) {
			await ensureChannel();
			await (
				await nativePlugin()
			).schedule({
				notifications: [
					{ id: notificationId(tag), title, body, channelId: CHANNEL_ID, autoCancel: true }
				]
			});
			return true;
		}
		if (typeof Notification === 'undefined') return false;
		new Notification(title, { body, tag });
		return true;
	} catch {
		return false;
	}
}
