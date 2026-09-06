import { test, expect } from '@playwright/test';

// User Story 1 (P1): fresh install requires PIN, wrong PIN is rejected, and the app
// re-locks on reload. The 5-minute auto-lock timer itself isn't exercised in real time
// here (that's covered by unit-level timer logic); this proves the observable gate.

test.describe('Onboarding & App Lock', () => {
	test('fresh install requires setting a PIN before anything else is shown', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
		await expect(page.getByLabel('Create PIN')).toBeVisible();
	});

	test('setting a PIN unlocks the app; reloading locks it again and rejects a wrong PIN', async ({
		page
	}) => {
		await page.goto('/');

		await page.getByLabel('Create PIN').fill('1234');
		await page.getByLabel('Confirm PIN').fill('1234');
		await page.getByRole('button', { name: 'Set PIN' }).click();

		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

		await page.reload();

		await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();

		await page.getByLabel('PIN').fill('0000');
		await page.getByRole('button', { name: 'Unlock' }).click();
		await expect(page.getByText('Incorrect PIN.')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Dashboard' })).not.toBeVisible();

		await page.getByLabel('PIN').fill('1234');
		await page.getByRole('button', { name: 'Unlock' }).click();
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	});

	test('opening the app in a second tab blocks the second tab until the first closes', async ({
		context
	}) => {
		const pageA = await context.newPage();
		await pageA.goto('/');
		await pageA.getByLabel('Create PIN').fill('5678');
		await pageA.getByLabel('Confirm PIN').fill('5678');
		await pageA.getByRole('button', { name: 'Set PIN' }).click();
		await expect(pageA.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

		const pageB = await context.newPage();
		await pageB.goto('/');
		await expect(pageB.getByText('Already open in another tab')).toBeVisible();

		await pageA.close();
		await expect(pageB.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible({
			timeout: 5000
		});
	});
});
