import { test, expect, type Page } from '@playwright/test';

// How moving around leaves the browser's (and the Android app's) Back history: a form that was
// saved or cancelled is not a place to come back to, and the sidebar marks exactly one screen open.

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function addAccount(page: Page, name: string) {
	await page.getByRole('link', { name: 'Accounts', exact: true }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Opening balance').fill('1000');
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

test('the sidebar groups match the hubs and only the open screen is marked', async ({ page }) => {
	await onboard(page, '604815');

	await expect(page.locator('aside nav p')).toHaveText([
		'Money',
		'Plan',
		'Wealth',
		'Insights',
		'Manage'
	]);

	// Budget vs. Actual lives under /budgets, but must not also light up Budgets.
	await page.goto('/budgets/variance');
	const sidebar = page.locator('aside');
	await expect(sidebar.getByRole('link', { name: 'Budget vs. Actual' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(sidebar.getByRole('link', { name: 'Budgets', exact: true })).not.toHaveAttribute(
		'aria-current',
		'page'
	);

	await page.goto('/liabilities/payoff-planner');
	await expect(sidebar.getByRole('link', { name: 'Payoff Planner' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(sidebar.getByRole('link', { name: 'Liabilities', exact: true })).not.toHaveAttribute(
		'aria-current',
		'page'
	);
});

test('a saved or cancelled new-transaction form is not left in the Back history', async ({
	page
}) => {
	await onboard(page, '604816');
	await addAccount(page, 'Checking');

	await page.getByRole('link', { name: 'Transactions', exact: true }).click();
	await expect(page).toHaveURL(/\/transactions$/);

	// Cancel goes back to where the form was opened from, without adding an entry.
	await page.getByRole('link', { name: 'New transaction' }).click();
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	await expect(page).toHaveURL(/\/transactions$/);

	// Saving replaces the form with the list.
	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('25');
	await page.getByLabel('Notes').fill('Coffee');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByText('Coffee')).toBeVisible();

	// Back from the saved list never lands on the form that was just submitted.
	await page.goBack();
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toHaveCount(0);
	await expect(page).toHaveURL(/\/transactions$/);
	await page.goBack();
	await expect(page).toHaveURL(/\/accounts$/);
});

test('a form opened directly cancels to the list instead of leaving the app', async ({ page }) => {
	await onboard(page, '604817');
	await page.goto('/transactions/new');
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	await expect(page).toHaveURL(/\/transactions$/);
});
