// localStorage that never throws. Access can fail outright in a private window, with site data
// blocked, or in a restricted WebView — and everything stored here is a per-device convenience
// (a dismissed banner, a seen tour), never data the app needs to function.

export function safeGetItem(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function safeSetItem(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Best-effort only.
	}
}

export function safeRemoveItem(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		// Best-effort only.
	}
}

/** Keys the app keeps in localStorage that describe the *user's setup*, and so must be forgotten
 *  when everything is cleared (see `resetEverything`). */
export const SETUP_STORAGE_KEYS = [
	'APP_QUICK_TOUR_SEEN',
	'STORAGE_WARNING_DISMISSED_UNTIL',
	'myfin.autoBackup',
	'myfin.biometricPromptSnoozedUntil',
	'myfin.backupNudgeDay'
] as const;

export function clearSetupStorage(): void {
	for (const key of SETUP_STORAGE_KEYS) safeRemoveItem(key);
}
