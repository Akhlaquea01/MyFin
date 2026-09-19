import { test, expect } from '@playwright/test';
import { lockAndReload } from './helpers';

// User Story 5 (P3, spec 019): Ctrl+K opens a keyboard-accessible search overlay over
// transactions/payees/accounts, reachable only while unlocked. See quickstart.md §5.

test('Ctrl+K opens the palette, searches, navigates on select, and Escape closes it', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('194738');
	await page.getByLabel('Confirm PIN').fill('194738');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('0');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	// Escape closes without navigating.
	await page.keyboard.press('Control+k');
	await expect(page.getByPlaceholder('Search transactions, payees, accounts…')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByPlaceholder('Search transactions, payees, accounts…')).not.toBeVisible();

	// Search for the account just created, and select it.
	await page.keyboard.press('Control+k');
	await page.getByPlaceholder('Search transactions, payees, accounts…').fill('Checking');
	await page.getByRole('option', { name: /Checking/ }).click();
	await expect(page).toHaveURL(/\/accounts$/);
	await expect(page.getByPlaceholder('Search transactions, payees, accounts…')).not.toBeVisible();
});

test('the command palette is not reachable while the app is locked', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('194738');
	await page.getByLabel('Confirm PIN').fill('194738');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await lockAndReload(page);
	await expect(page.getByLabel('PIN')).toBeVisible();

	await page.keyboard.press('Control+k');
	await expect(page.getByPlaceholder('Search transactions, payees, accounts…')).not.toBeVisible();
});
