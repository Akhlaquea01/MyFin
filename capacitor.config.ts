import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android packaging (see docs/deployment/BUILD.md).
 *
 * - `appId` is the Android application ID. Treat it as permanent: Android keys an installed
 *   app's data to it, so changing it later installs a *different* app with an empty database.
 * - `webDir` is Vite's production output. The Android build uses
 *   `npm run build -- --mode capacitor`, which turns the PWA/service worker off (the APK is
 *   its own offline package, and a service worker would outlive an app update).
 * - `server.androidScheme` is deliberately left at its default (`https://localhost`): IndexedDB
 *   is origin-bound, so changing the scheme or hostname would orphan every user's data.
 */
const config: CapacitorConfig = {
	appId: 'io.github.akhlaquea01.myfin',
	appName: 'MyFin',
	webDir: 'dist',
	// Same as the PWA manifest's background_color, so there is no white flash on launch.
	backgroundColor: '#0b0f19',
	plugins: {
		LocalNotifications: {
			// The status-bar icon of bill/budget reminders: android/app/src/main/res/drawable/ic_stat_myfin.xml
			smallIcon: 'ic_stat_myfin'
		}
	}
};

export default config;
