import type { Page } from '@playwright/test';

/**
 * Deletes the persisted session handle (spec 009) so the next load goes through the lock
 * screen.
 *
 * Needed because a reload on its own no longer locks the app: session resume deliberately
 * carries an unlocked session across a refresh inside the auto-lock window. Tests that want
 * the lock screen — either to assert it, or to exercise the once-per-unlock work that hangs
 * off it — have to end the session first, and waiting out the five-minute auto-lock deadline
 * is not an option in a test.
 *
 * Not exported from a `.spec.ts` file on purpose: `testMatch` only picks up `*.spec.ts`, so
 * this module is a plain import rather than an empty test file.
 */
export async function clearSessionKey(page: Page): Promise<void> {
	await page.evaluate(
		() =>
			new Promise<void>((resolve, reject) => {
				const open = indexedDB.open('myfin');
				open.onerror = () => reject(open.error);
				open.onsuccess = () => {
					const db = open.result;
					if (!db.objectStoreNames.contains('sessionKeys')) {
						db.close();
						resolve();
						return;
					}
					const tx = db.transaction('sessionKeys', 'readwrite');
					tx.objectStore('sessionKeys').clear();
					tx.oncomplete = () => {
						db.close();
						resolve();
					};
					tx.onerror = () => reject(tx.error);
				};
			})
	);
}

/** Ends the session and reloads, landing on the lock screen. */
export async function lockAndReload(page: Page): Promise<void> {
	await clearSessionKey(page);
	await page.reload();
}
