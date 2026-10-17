import { expect, type Page } from '@playwright/test';

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

/**
 * Presses the action button of the app's own confirmation dialog (it replaced the browser's
 * `window.confirm`, so Playwright's `page.on('dialog')` no longer sees it). Optionally checks what
 * the dialog says first.
 */
export async function acceptConfirm(page: Page, text?: string | RegExp): Promise<void> {
	const dialog = page.getByRole('alertdialog');
	if (text !== undefined) await expect(dialog).toContainText(text);
	await dialog.locator('[data-slot="alert-dialog-action"]').click();
	await expect(dialog).not.toBeVisible();
}

/** Presses Cancel on the confirmation dialog. */
export async function dismissConfirm(page: Page, text?: string | RegExp): Promise<void> {
	const dialog = page.getByRole('alertdialog');
	if (text !== undefined) await expect(dialog).toContainText(text);
	await dialog.locator('[data-slot="alert-dialog-cancel"]').click();
	await expect(dialog).not.toBeVisible();
}

/**
 * For tests that confirm many prompts in a row and do not care about each one: answers every
 * confirmation dialog that appears with its action button.
 */
export async function autoAcceptConfirms(page: Page): Promise<void> {
	await page.addLocatorHandler(page.getByRole('alertdialog'), async (dialog) => {
		await dialog.locator('[data-slot="alert-dialog-action"]').click();
	});
}

/**
 * Opens one of the screens the sidebar folds into a single entry: Data (Import, Export, Backup),
 * Automation (Auto-capture, Auto-Categorize, Notifications) or Settings (Security, About). The
 * entry opens the hub's first screen and the strip along the top of the page reaches the rest.
 */
export async function openScreen(
	page: Page,
	hub: 'Data' | 'Automation' | 'Settings',
	screen: string
): Promise<void> {
	await page.getByRole('link', { name: hub, exact: true }).click();
	await page
		.getByRole('navigation', { name: `${hub} screens` })
		.getByRole('link', { name: screen, exact: true })
		.click();
}
