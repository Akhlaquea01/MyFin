// Wrapper over the local Android `TransactionCapture` plugin (see
// android/.../capture/TransactionCapturePlugin.java). Native code catches bank SMS and payment
// notifications while the app is closed or locked, locks each one in a sealed box (see
// data/crypto/sealedBox.ts) and queues it; the app drains that queue after unlock.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { SealedCaptureItem } from '../../data/crypto/sealedBox';
import { isNativePluginAvailable } from './platform';

const PLUGIN_NAME = 'TransactionCapture';

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale';

export interface CaptureStatus {
	/** Android API level, so the UI knows whether the notification permission applies (33+). */
	sdkInt: number;
	/** Permission to receive SMS. */
	sms: PermissionState;
	/** Permission to show MyFin's own "new transactions to review" notification (API 33+). */
	postNotifications: PermissionState;
	/** Whether "Notification access" is switched on for MyFin in Android settings. */
	notificationListenerEnabled: boolean;
	/** Whether Android lets MyFin show notifications at all. */
	alertsEnabled: boolean;
	sealingKeyPresent: boolean;
	smsEnabled: boolean;
	notificationsEnabled: boolean;
	/** Sealed messages waiting to be drained. */
	pending: number;
	/** Messages discarded because the queue was full since the last drain. */
	dropped: number;
}

interface TransactionCapturePlugin {
	getStatus(): Promise<CaptureStatus>;
	requestPermissions(options: {
		permissions: ('sms' | 'postNotifications')[];
	}): Promise<{ sms: PermissionState; postNotifications: PermissionState }>;
	openNotificationAccessSettings(): Promise<void>;
	openAppSettings(): Promise<void>;
	setSealingKey(options: { publicKey: string; keyId: string }): Promise<CaptureStatus>;
	setEnabled(options: { sms?: boolean; notifications?: boolean }): Promise<CaptureStatus>;
	/** Seals a known string with the stored public key (not queued), to prove native and the app
	 *  agree on the format before capture is switched on. */
	selfTest(): Promise<{ item: SealedCaptureItem }>;
	drainQueue(options?: {
		limit?: number;
	}): Promise<{ items: SealedCaptureItem[]; remaining: number; dropped: number }>;
	ack(options: { ids: string[] }): Promise<{ removed: number; remaining: number }>;
	/** Disables capture and wipes the queue, keys and alerts (used by "Clear all data"). */
	clear(): Promise<void>;
	cancelAlert(): Promise<void>;
	addListener(
		eventName: 'captured',
		listener: (event: { pending: number }) => void
	): Promise<PluginListenerHandle>;
}

/** The text native seals for `selfTest`; the app checks it comes back unchanged. */
export const SELF_TEST_TEXT = 'myfin-capture-self-test';

let plugin: TransactionCapturePlugin | undefined;
// Registered on first use, not at import, like the other native wrappers.
function getPlugin(): TransactionCapturePlugin {
	plugin ??= registerPlugin<TransactionCapturePlugin>(PLUGIN_NAME);
	return plugin;
}

export function isTransactionCaptureAvailable(): boolean {
	return isNativePluginAvailable(PLUGIN_NAME);
}

export const TransactionCapture = {
	getStatus: () => getPlugin().getStatus(),
	requestPermissions: (permissions: ('sms' | 'postNotifications')[]) =>
		getPlugin().requestPermissions({ permissions }),
	openNotificationAccessSettings: () => getPlugin().openNotificationAccessSettings(),
	openAppSettings: () => getPlugin().openAppSettings(),
	setSealingKey: (publicKey: string, keyId: string) =>
		getPlugin().setSealingKey({ publicKey, keyId }),
	setEnabled: (flags: { sms?: boolean; notifications?: boolean }) => getPlugin().setEnabled(flags),
	selfTest: () => getPlugin().selfTest(),
	drainQueue: (limit?: number) => getPlugin().drainQueue(limit === undefined ? {} : { limit }),
	ack: (ids: string[]) => getPlugin().ack({ ids }),
	clear: () => getPlugin().clear(),
	cancelAlert: () => getPlugin().cancelAlert(),
	onCaptured: (listener: (event: { pending: number }) => void) =>
		getPlugin().addListener('captured', listener)
};
