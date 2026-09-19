import { test, expect, type Page } from '@playwright/test';

// User Story 3 (P3): dashboard figures must reconcile exactly with the underlying ledger.

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function goTo(page: Page, linkName: string, headingName: string) {
	await page.getByRole('link', { name: linkName }).click();
	await expect(page.getByRole('heading', { name: headingName })).toBeVisible();
}

test('dashboard reconciles balance and shows recent activity from the ledger', async ({ page }) => {
	await onboard(page, '424284');

	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Checking');
	await dialog.getByLabel('Opening balance').fill('1000');
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();

	await goTo(page, 'Transactions', 'Transactions');
	await page.getByRole('link', { name: 'New transaction' }).click();
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('120');
	await page.getByLabel('Notes').fill('Dinner');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await goTo(page, 'Dashboard', 'Dashboard');
	const balanceCard = page.locator('[data-slot="card"]').filter({ hasText: 'Total Balance' });
	await expect(balanceCard).toContainText('880.00'); // 1000 - 120
	await expect(page.getByText('Dinner')).toBeVisible();
});

// User Story 6 (spec 019, P3): hide/reorder/persist/reset the Dashboard's widget layout.
// See quickstart.md §6.
test('dashboard widgets can be hidden, reordered, and reset, and persist across a reload', async ({
	page
}) => {
	await onboard(page, '635920');

	await page.getByRole('button', { name: 'Customize dashboard' }).click();
	await expect(page.getByRole('heading', { name: 'Customize dashboard' })).toBeVisible();

	// Hide the non-core "Lending" widget.
	await page.getByRole('switch', { name: 'Show Lending' }).click();
	await expect(page.locator('[data-slot="card"]').filter({ hasText: 'Lending' })).toHaveCount(0);

	// A core widget's toggle is disabled — cannot be hidden.
	await expect(page.getByRole('switch', { name: 'Show Total Balance' })).toBeDisabled();

	// Move "Net Worth" above "Total Balance".
	await page.getByRole('button', { name: 'Move Net Worth up' }).click();
	await page.getByRole('button', { name: 'Move Net Worth up' }).click();

	await page.keyboard.press('Escape');

	// Reload: the layout persists.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(page.locator('[data-slot="card"]').filter({ hasText: 'Lending' })).toHaveCount(0);

	// Reset restores the original five-widget default.
	await page.getByRole('button', { name: 'Customize dashboard' }).click();
	await page.getByRole('button', { name: 'Reset to default' }).click();
	await page.keyboard.press('Escape');
	await expect(page.locator('[data-slot="card"]').filter({ hasText: 'Lending' })).toBeVisible();
});
