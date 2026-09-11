import { test, expect } from '@playwright/test';
import { clearSessionKey } from './helpers';

// User Story 1 (P1): fresh install requires PIN, wrong PIN is rejected, and the app
// re-locks on reload. The 5-minute auto-lock timer itself isn't exercised in real time
// here (that's covered by unit-level timer logic); this proves the observable gate.

test.describe('Onboarding & App Lock', () => {
	test('fresh install requires setting a PIN before anything else is shown', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
		await expect(page.getByLabel('Create PIN')).toBeVisible();
	});

	test('a weak PIN is rejected with a specific reason', async ({ page }) => {
		await page.goto('/');

		// Too short: the floor is 6 digits, because the PIN is the only thing protecting an
		// exported backup against offline guessing.
		await page.getByLabel('Create PIN').fill('1234');
		await page.getByLabel('Confirm PIN').fill('1234');
		await page.getByRole('button', { name: 'Set PIN' }).click();
		await expect(page.getByText('Your PIN must be 6-12 digits.')).toBeVisible();

		// Long enough, but a consecutive run.
		await page.getByLabel('Create PIN').fill('123456');
		await page.getByLabel('Confirm PIN').fill('123456');
		await page.getByRole('button', { name: 'Set PIN' }).click();
		await expect(page.getByText(/run of consecutive digits/)).toBeVisible();

		// Long enough, but a single repeated digit.
		await page.getByLabel('Create PIN').fill('444444');
		await page.getByLabel('Confirm PIN').fill('444444');
		await page.getByRole('button', { name: 'Set PIN' }).click();
		await expect(page.getByText(/same digit repeated/)).toBeVisible();

		// Still on onboarding: nothing was created.
		await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
	});

	test('setting a PIN unlocks the app; a reload resumes, and a cleared session rejects a wrong PIN', async ({
		page
	}) => {
		await page.goto('/');

		await page.getByLabel('Create PIN').fill('482915');
		await page.getByLabel('Confirm PIN').fill('482915');
		await page.getByRole('button', { name: 'Set PIN' }).click();

		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

		// Spec 009: a reload inside the auto-lock window resumes silently rather than demanding
		// the PIN again. (This assertion used to read "reloading locks it again", which stopped
		// being true when session resume shipped — the test was left asserting the old
		// behaviour and had been failing ever since.)
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

		// Drop the persisted session handle, which is what expiry or an explicit lock does, and
		// the PIN is required again.
		await clearSessionKey(page);
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();

		await page.getByLabel('PIN').fill('0000');
		await page.getByRole('button', { name: 'Unlock' }).click();
		await expect(page.getByText('Incorrect PIN.')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Dashboard' })).not.toBeVisible();

		await page.getByLabel('PIN').fill('482915');
		await page.getByRole('button', { name: 'Unlock' }).click();
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	});

	test('opening the app in a second tab blocks the second tab until the first closes', async ({
		context
	}) => {
		const pageA = await context.newPage();
		await pageA.goto('/');
		await pageA.getByLabel('Create PIN').fill('567849');
		await pageA.getByLabel('Confirm PIN').fill('567849');
		await pageA.getByRole('button', { name: 'Set PIN' }).click();
		await expect(pageA.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

		const pageB = await context.newPage();
		await pageB.goto('/');
		await expect(pageB.getByText('Already open in another tab')).toBeVisible();

		await pageA.close();
		// pageB is promoted to primary and resumes the session it already had, so it lands on
		// the dashboard rather than the lock screen.
		await expect(pageB.getByRole('heading', { name: 'Dashboard' })).toBeVisible({
			timeout: 10000
		});
	});
});
