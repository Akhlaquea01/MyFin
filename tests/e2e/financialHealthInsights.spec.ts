import { test, expect } from '@playwright/test';

// Spec 007 (Financial Health Insights): headline figures, trend, and composite score must
// match manual computation and move in the correct direction as the underlying ledger changes
// (quickstart.md Scenarios 1, 3, 5).

test('financial health figures match manual computation and the score moves with new spend', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('4242');
	await page.getByLabel('Confirm PIN').fill('4242');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('0');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Categories' }).click();
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Groceries');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	// A within-limit budget (planned 200, actual will be 100) so adherence is 100%.
	await page.getByRole('link', { name: 'Budgets' }).click();
	await page.getByRole('button', { name: 'Add budget' }).click();
	const budgetDialog = page.getByRole('dialog');
	await budgetDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Groceries' }).click();
	await budgetDialog.getByLabel('Amount', { exact: true }).fill('200');
	await budgetDialog.getByRole('button', { name: 'Add budget' }).click();
	await expect(budgetDialog).not.toBeVisible();

	// Income 1000, expense 100 -> savings rate 90%, expense/income ratio 10%.
	await page.getByRole('link', { name: 'Transactions' }).click();
	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Type').click();
	await page.getByRole('option', { name: 'Income' }).click();
	await page.getByLabel('Amount').fill('1000');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('100');
	await page.locator('button[role="combobox"]').filter({ hasText: 'Category…' }).click();
	await page.getByRole('option', { name: 'Groceries' }).click();
	await page.locator('input[placeholder="Amount"]').fill('100');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await page.getByRole('link', { name: 'Financial Health' }).click();
	await expect(page.getByRole('heading', { name: 'Financial Health' })).toBeVisible();
	await expect(page.getByText('90.0%').first()).toBeVisible(); // savings rate
	await expect(page.getByText('10.0%').first()).toBeVisible(); // expense-to-income ratio
	await expect(page.getByText('100%').first()).toBeVisible(); // budget adherence, 1-for-1 within limit

	const scoreBefore = await page.locator('text=/^[0-9]+$/').first().textContent();

	// Add an over-limit expense: worsens both savings rate and budget adherence.
	await page.getByRole('link', { name: 'Transactions' }).click();
	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('500');
	await page.locator('button[role="combobox"]').filter({ hasText: 'Category…' }).click();
	await page.getByRole('option', { name: 'Groceries' }).click();
	await page.locator('input[placeholder="Amount"]').fill('500');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await page.getByRole('link', { name: 'Financial Health' }).click();
	await expect(page.getByRole('heading', { name: 'Financial Health' })).toBeVisible();
	await expect(page.getByText('40.0%').first()).toBeVisible(); // savings rate: (1000-600)/1000
	await expect(page.getByText('60.0%').first()).toBeVisible(); // expense-to-income ratio: 600/1000

	const scoreAfter = await page.locator('text=/^[0-9]+$/').first().textContent();
	expect(Number(scoreAfter)).toBeLessThan(Number(scoreBefore));
});

test('shows a "not enough data" empty state with no transactions', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('5151');
	await page.getByLabel('Confirm PIN').fill('5151');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Financial Health' }).click();
	await expect(page.getByRole('heading', { name: 'Financial Health' })).toBeVisible();
	await expect(page.getByText('No data in this range yet.')).toBeVisible();
});
