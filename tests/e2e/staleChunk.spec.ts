import { test, expect } from '@playwright/test';

// Pages load on demand. If the app was redeployed while a tab was open, the old page files are
// gone: the first failed fetch reloads the app once (the unlocked session resumes without the
// PIN) instead of leaving a blank page.

test('a page whose code fails to load once recovers by reloading', async ({ page }) => {
	let attempts = 0;
	await page.route('**/assets/AccountsPage-*.js', (route) => {
		attempts += 1;
		return attempts === 1 ? route.abort() : route.continue();
	});

	await page.goto('/');
	await page.getByLabel('Create PIN').fill('135784');
	await page.getByLabel('Confirm PIN').fill('135784');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
	expect(attempts).toBeGreaterThanOrEqual(2);
});
