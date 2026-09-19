import { test, expect } from '@playwright/test';

// User Story 2 (P1, spec 019): the forecast page projects a balance trajectory and warns
// in advance of a projected shortfall. See quickstart.md §2.

test('a large scheduled expense produces an advance low-balance warning', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('676784');
	await page.getByLabel('Confirm PIN').fill('676784');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('1000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Categories' }).click();
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Rent');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Recurring' }).click();
	await page.getByRole('button', { name: 'Add rule' }).click();
	const ruleDialog = page.getByRole('dialog');
	await ruleDialog.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking' }).click();
	await ruleDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Rent' }).click();
	// Weekly (not the default monthly day-of-month) so at least one occurrence is guaranteed
	// inside the 30-day horizon regardless of what day-of-month "today" happens to be.
	await ruleDialog.getByLabel('Frequency').click();
	await page.getByRole('option', { name: 'Weekly' }).click();
	await ruleDialog.getByLabel('Amount').fill('1500');
	await ruleDialog.getByRole('button', { name: 'Add rule' }).click();
	await expect(ruleDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Forecast' }).click();
	await expect(page.getByRole('heading', { name: 'Cash-Flow Forecast' })).toBeVisible();
	await expect(page.getByText('Low balance warning')).toBeVisible();
});

test('an account with no history shows a low-confidence notice', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('676784');
	await page.getByLabel('Confirm PIN').fill('676784');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Savings');
	await accountDialog.getByLabel('Opening balance').fill('5000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Forecast' }).click();
	await expect(page.getByText('Not enough recurring or historical data')).toBeVisible();
});
