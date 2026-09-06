// FR-045 / research.md #5: only one browser tab/window may hold read-write access at a
// time, to prevent two tabs from corrupting balances with concurrent writes. Uses the Web
// Locks API, which every target browser (Chrome, Firefox, Safari 15.4+) supports; on an
// unsupported browser we fail open (`unsupported`) rather than permanently blocking the
// user, since a broken lock screen would be worse than the (rare) risk it's guarding
// against on those browsers.

const LOCK_NAME = 'myfin-single-instance';
const POLL_INTERVAL_MS = 2000;

export type InstanceRole = 'primary' | 'secondary' | 'unsupported';

/** Returns a cleanup function that stops polling (call it if the app unmounts). */
export function acquireSingleInstanceLock(onRoleChange: (role: InstanceRole) => void): () => void {
	if (!('locks' in navigator)) {
		onRoleChange('unsupported');
		return () => {};
	}

	let stopped = false;
	let pollHandle: ReturnType<typeof setInterval> | undefined;

	function holdForever(): Promise<void> {
		return new Promise<void>((resolve) => {
			window.addEventListener('pagehide', () => resolve(), { once: true });
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
				onRoleChange('primary');
				await holdForever();
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
	};
}
