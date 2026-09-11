// FR-045 / research.md #5: only one browser tab/window may hold read-write access at a
// time, to prevent two tabs from corrupting balances with concurrent writes. Uses the Web
// Locks API, which every target browser (Chrome, Firefox, Safari 15.4+) supports; on an
// unsupported browser we fail open (`unsupported`) rather than permanently blocking the
// user, since a broken lock screen would be worse than the (rare) risk it's guarding
// against on those browsers.

const LOCK_NAME = 'myfin-single-instance';
const POLL_INTERVAL_MS = 2000;
/**
 * How long to wait before believing "another tab holds the lock".
 *
 * Releasing a Web Lock is asynchronous, so an immediate re-request can still observe the lock
 * this very page just gave up. That happens on any remount — React StrictMode does exactly
 * this in development, mounting, cleaning up, and remounting in one tick, which made a lone
 * tab declare itself secondary and sit on BlockedScreen until the 2s poll rescued it. One
 * short retry removes the false positive without weakening the real cross-tab guarantee.
 */
const CONFIRM_SECONDARY_DELAY_MS = 150;

export type InstanceRole = 'primary' | 'secondary' | 'unsupported';

/** Returns a cleanup function that stops polling (call it if the app unmounts). */
export function acquireSingleInstanceLock(onRoleChange: (role: InstanceRole) => void): () => void {
	if (!('locks' in navigator)) {
		onRoleChange('unsupported');
		return () => {};
	}

	let stopped = false;
	let pollHandle: ReturnType<typeof setInterval> | undefined;
	let retryHandle: ReturnType<typeof setTimeout> | undefined;
	/** Resolves the promise holding the lock, so cleanup can hand it back. */
	let releaseLock: (() => void) | undefined;
	/** Whether we've already given the lock one grace retry this mount. */
	let secondaryConfirmed = false;

	// Holds the lock until this page is genuinely gone. `pagehide` also fires when the page
	// enters the back/forward cache, where the tab stays alive and fully able to write — a
	// `{ once: true }` listener that resolved on any pagehide released the lock there and
	// never reacquired it, leaving a live tab writing with no lock at all (exactly what
	// FR-045 exists to prevent). `event.persisted` distinguishes the two cases.
	function holdUntilGone(): Promise<void> {
		return new Promise<void>((resolve) => {
			// Also resolved by the cleanup function below, so unmounting actually hands the lock
			// back instead of pinning it for the lifetime of the document.
			releaseLock = resolve;
			const onPageHide = (event: PageTransitionEvent) => {
				if (event.persisted) return; // bfcache — keep holding
				window.removeEventListener('pagehide', onPageHide);
				resolve();
			};
			window.addEventListener('pagehide', onPageHide);
		});
	}

	function tryBecomePrimary() {
		void navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
			if (stopped) return;
			if (lock) {
				if (pollHandle) {
					clearInterval(pollHandle);
					pollHandle = undefined;
				}
				secondaryConfirmed = true; // any later loss of the lock is a real one
				onRoleChange('primary');
				await holdUntilGone();
				releaseLock = undefined;
			} else if (!secondaryConfirmed) {
				// First miss on this mount: probably our own lock still being released. Retry once
				// shortly before telling the user another tab has it.
				secondaryConfirmed = true;
				retryHandle = setTimeout(tryBecomePrimary, CONFIRM_SECONDARY_DELAY_MS);
			} else {
				onRoleChange('secondary');
				if (!pollHandle) {
					pollHandle = setInterval(tryBecomePrimary, POLL_INTERVAL_MS);
				}
			}
		});
	}

	tryBecomePrimary();

	return () => {
		stopped = true;
		if (pollHandle) clearInterval(pollHandle);
		if (retryHandle) clearTimeout(retryHandle);
		// Hand the lock back so a remount can take it. Without this the lock stayed held by a
		// promise nothing would ever resolve, and the remounting instance saw itself as a second
		// tab.
		releaseLock?.();
		releaseLock = undefined;
	};
}
