// A page's code is fetched the first time its route opens. If the app was redeployed since this
// tab loaded, the old file names are gone and that fetch fails — the user sees a blank page for
// no reason of their own. One reload picks up the new build (an unlocked session resumes without
// the PIN); the guard stops a genuinely broken deploy from reloading forever.

const RELOAD_STAMP_KEY = 'myfin.chunk-reload-at';
/** A second chunk failure inside this window means the reload did not help. */
const RELOAD_WINDOW_MS = 15_000;

export function shouldReloadForStaleChunk(now: number = Date.now()): boolean {
	try {
		const last = Number(sessionStorage.getItem(RELOAD_STAMP_KEY));
		if (Number.isFinite(last) && last > 0 && now - last < RELOAD_WINDOW_MS) return false;
		sessionStorage.setItem(RELOAD_STAMP_KEY, String(now));
		return true;
	} catch {
		// No sessionStorage: reloading could never be rate-limited, so do not risk a loop.
		return false;
	}
}
