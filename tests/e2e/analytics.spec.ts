import { test, expect } from '@playwright/test';

// User Story 8 (P8): analytics figures must match manual aggregation of the ledger.

test('spending-by-category figure matches the underlying transaction', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('717184');
	await page.getByLabel('Confirm PIN').fill('717184');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('5000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Categories' }).click();
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Groceries');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Transactions' }).click();
	await page.getByRole('link', { name: 'New transaction' }).click();
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('75');
	await page.locator('button[role="combobox"]').filter({ hasText: 'Category…' }).click();
	await page.getByRole('option', { name: 'Groceries' }).click();
	await page.locator('input[placeholder="Amount"]').fill('75');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await page.getByRole('link', { name: 'Analytics' }).click();
	await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();
	await expect(page.getByText('Spending by category')).toBeVisible();
	await expect(page.getByText('Income vs. expense')).toBeVisible();
	await expect(page.getByText('Cash flow')).toBeVisible();
	await expect(page.getByText('Net worth trend')).toBeVisible();
	await expect(page.getByText('Budget performance')).toBeVisible();
});

// Budget performance shows one month at a time, picked from Month and Year dropdowns, instead of
// listing every period of every budget down the page.
test('budget performance shows the chosen month, defaulting to the current one', async ({
	page
}) => {
	const now = new Date();
	const currentMonth = now.toLocaleString('en-US', { month: 'long' });
	const otherMonth = now.getMonth() === 0 ? 'February' : 'January';

	await page.goto('/');
	await page.getByLabel('Create PIN').fill('481926');
	await page.getByLabel('Confirm PIN').fill('481926');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Categories' }).click();
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Groceries');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Budgets' }).click();
	await page.getByRole('button', { name: 'Add budget' }).click();
	const budgetDialog = page.getByRole('dialog');
	await budgetDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Groceries' }).click();
	await budgetDialog.getByLabel('Amount', { exact: true }).fill('100');
	await budgetDialog.getByRole('button', { name: 'Add budget' }).click();
	await expect(budgetDialog).not.toBeVisible();

	// Spending recorded after the budget was opened must still show up on Analytics.
	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('5000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();
	await page.getByRole('link', { name: 'Transactions' }).click();
	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('40');
	await page.locator('button[role="combobox"]').filter({ hasText: 'Category…' }).click();
	await page.getByRole('option', { name: 'Groceries' }).click();
	await page.locator('input[placeholder="Amount"]').fill('40');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await page.getByRole('link', { name: 'Analytics' }).click();
	const card = page.locator('[data-slot="card"]').filter({ hasText: 'Budget performance' });
	await expect(card.getByRole('combobox', { name: 'Month' })).toHaveText(currentMonth);
	await expect(card.getByRole('combobox', { name: 'Year' })).toHaveText(String(now.getFullYear()));
	await expect(card.getByText('Groceries')).toBeVisible();
	await expect(card.getByText('₹40.00 of ₹100.00')).toBeVisible();

	await card.getByRole('combobox', { name: 'Month' }).click();
	await page.getByRole('option', { name: otherMonth, exact: true }).click();
	await expect(card.getByText(`No budgets for ${otherMonth} ${now.getFullYear()}.`)).toBeVisible();
	await expect(card.getByText('Groceries')).not.toBeVisible();

	// Changing the page's date range reloads the charts but keeps the month that was picked.
	await page.getByRole('button', { name: 'All time' }).click();
	await expect(card.getByRole('combobox', { name: 'Month' })).toHaveText(otherMonth);
});
