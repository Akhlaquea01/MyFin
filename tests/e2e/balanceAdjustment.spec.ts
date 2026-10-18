import { test, expect, type Page } from '@playwright/test';

// "Adjust balance" brings an account to what it really holds. That is a correction, not money
// earned or spent: it moves the balance, is labelled as an adjustment in the ledger, and stays out
// of the income and spending figures.

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

test('adjusting a balance moves it without counting as income or spending', async ({ page }) => {
	await onboard(page, '474747');

	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const addDialog = page.getByRole('dialog');
	await addDialog.getByLabel('Name').fill('Wallet');
	await addDialog.getByLabel('Opening balance').fill('1000');
	await addDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(addDialog).not.toBeVisible();

	// The cash counted is 1,200 rather than the 1,000 tracked.
	const card = page.locator('[data-slot="card"]').filter({ hasText: 'Wallet' });
	await card.getByRole('button', { name: 'Wallet actions' }).click();
	await page.getByRole('menuitem', { name: 'Adjust balance' }).click();
	const adjustDialog = page.getByRole('dialog');
	await expect(adjustDialog).toContainText('It is not counted as income or spending.');
	await adjustDialog.getByLabel('Actual balance').fill('1200');
	await adjustDialog.getByRole('button', { name: 'Save' }).click();
	await expect(adjustDialog).not.toBeVisible();
	await expect(card.getByText('₹1,200.00')).toBeVisible();

	// The ledger shows it as an adjustment - not as income, and not as a loan.
	await goTo(page, 'Transactions', 'Transactions');
	const row = page.getByRole('row').filter({ hasText: 'Balance adjustment' });
	await expect(row.getByText('Adjustment', { exact: true })).toBeVisible();
	await expect(row.getByText('Loan', { exact: true })).toHaveCount(0);

	// It can be corrected as itself, and stays out of the way of spending.
	await row.getByRole('button', { name: 'Edit transaction' }).click();
	const editDialog = page.getByRole('dialog');
	await expect(editDialog).toContainText('This is a balance adjustment');
	await expect(editDialog.getByLabel('Category')).toHaveCount(0);
	await editDialog.getByLabel('Amount').fill('250');
	await editDialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(editDialog).not.toBeVisible();

	await goTo(page, 'Accounts', 'Accounts');
	await expect(
		page.locator('[data-slot="card"]').filter({ hasText: 'Wallet' }).getByText('₹1,250.00')
	).toBeVisible();

	// Nothing was earned or spent, so the dashboard has no money in or out to report.
	await goTo(page, 'Dashboard', 'Dashboard');
	const flow = page.locator('[data-slot="card"]').filter({ hasText: 'Money in' });
	await expect(flow).toContainText('Money out');
	await expect(flow.getByText('₹0.00', { exact: true })).toHaveCount(2);
});
