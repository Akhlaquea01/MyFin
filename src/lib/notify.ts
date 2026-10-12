// One place that knows how to show a notification. In the Android app that means a real Android
// notification through the Capacitor LocalNotifications plugin (the browser's Notification API
// does not exist inside Android WebView, which is why reminders never appeared there); in a
// browser or installed PWA it is the Notification API, exactly as before.
//
// Notifications that carry anything about the user's money are only ever shown right away, from
// content that is already in memory after unlock — nothing financial is handed to an OS scheduler
// to be stored and fired later. The one exception is the weekly backup reminder at the bottom,
// whose text is fixed and says nothing about the user's data.
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
export async function showNotification(
	title: string,
	body: string,
	tag: string,
	/** App route to open when the notification is tapped (Android app only). */
	route?: string
): Promise<boolean> {
	try {
		if (isNativeApp()) {
			await ensureChannel();
			await (
				await nativePlugin()
			).schedule({
				notifications: [
					{
						id: notificationId(tag),
						title,
						body,
						channelId: CHANNEL_ID,
						autoCancel: true,
						...(route ? { extra: { route } } : {})
					}
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

export const BACKUP_REMINDER_TAG = 'backup-reminder';

/**
 * Schedules the weekly "back up your data" reminder (Android app only), first firing at `firstAt`.
 * Its text is fixed and mentions no amounts, merchants or accounts, so handing it to the OS
 * scheduler stores nothing about the user's finances. Replaces any earlier schedule (same id).
 * Resolves whether it was scheduled; never throws.
 */
export async function scheduleBackupReminder(firstAt: Date): Promise<boolean> {
	if (!isNativeApp()) return false;
	try {
		await ensureChannel();
		await (
			await nativePlugin()
		).schedule({
			notifications: [
				{
					id: notificationId(BACKUP_REMINDER_TAG),
					title: 'Time to back up MyFin',
					body: 'MyFin keeps your data only on this phone. Open Backup & Restore to save a copy.',
					channelId: CHANNEL_ID,
					autoCancel: true,
					schedule: { at: firstAt, repeats: true, every: 'week' },
					extra: { route: '/backup' }
				}
			]
		});
		return true;
	} catch {
		return false;
	}
}

export async function cancelBackupReminder(): Promise<void> {
	if (!isNativeApp()) return;
	try {
		await (
			await nativePlugin()
		).cancel({ notifications: [{ id: notificationId(BACKUP_REMINDER_TAG) }] });
	} catch {
		// Nothing scheduled, or the plugin is unavailable.
	}
}

/**
 * Calls `onRoute` with the route a tapped notification asked for (Android app only). Resolves a
 * function that stops listening.
 */
export async function onNotificationTapped(onRoute: (route: string) => void): Promise<() => void> {
	if (!isNativeApp()) return () => {};
	try {
		const handle = await (
			await nativePlugin()
		).addListener('localNotificationActionPerformed', (action) => {
			const route = (action.notification.extra as { route?: unknown } | undefined)?.route;
			if (typeof route === 'string' && route.startsWith('/')) onRoute(route);
		});
		return () => void handle.remove();
	} catch {
		return () => {};
	}
}
