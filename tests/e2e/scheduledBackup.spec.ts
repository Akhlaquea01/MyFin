import { test, expect } from '@playwright/test';

// User Story 7 (P4, spec 019): scheduled local encrypted backups. Headless Chromium cannot
// drive the native `showDirectoryPicker()` OS dialog non-interactively, so this covers the
// feature-detection and settings-UI paths only (plan.md's Testing section), not a real
// file-system write — see quickstart.md §7 for the manual verification steps.

test('shows the automatic-backup setup option when the browser supports it', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('301847');
	await page.getByLabel('Confirm PIN').fill('301847');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Backup' }).click();
	await expect(page.getByText('Automatic backups')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Choose backup folder' })).toBeVisible();
});

test('shows an honest unsupported-browser message when the File System Access API is absent', async ({
	page
}) => {
	// Force the unsupported path deterministically, rather than relying on Playwright's
	// Chromium happening to lack the API (it may well have it).
	await page.addInitScript(() => {
		// @ts-expect-error - simulating a browser without the File System Access API
		delete window.showDirectoryPicker;
	});

	await page.goto('/');
	await page.getByLabel('Create PIN').fill('301847');
	await page.getByLabel('Confirm PIN').fill('301847');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Backup' }).click();
	await expect(page.getByText('Automatic backups', { exact: true })).toBeVisible();
	await expect(page.getByText(/aren't available in this browser/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Choose backup folder' })).toHaveCount(0);
});
