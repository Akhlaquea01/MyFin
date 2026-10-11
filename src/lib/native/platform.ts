import { Capacitor } from '@capacitor/core';

/** True inside the Android app (Capacitor WebView), false in a browser or installed PWA. */
export function isNativeApp(): boolean {
	return Capacitor.isNativePlatform();
}

/** True when running natively AND the named local plugin is registered in this build. */
export function isNativePluginAvailable(name: string): boolean {
	return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(name);
}
