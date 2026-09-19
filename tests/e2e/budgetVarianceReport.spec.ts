import { test, expect } from '@playwright/test';

// User Story 3 (P2, spec 019): a dedicated budgeted-vs-actual report, distinct from Analytics.
// See quickstart.md §3.

test('the variance report shows a budgeted category for the current month', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('676784');
	await page.getByLabel('Confirm PIN').fill('676784');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Categories' }).click();
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Groceries');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Budgets', exact: true }).click();
	await page.getByRole('button', { name: 'Add budget' }).click();
	const budgetDialog = page.getByRole('dialog');
	await budgetDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Groceries' }).click();
	await budgetDialog.getByLabel('Amount').fill('100');
	await budgetDialog.getByRole('button', { name: 'Add budget' }).click();
	await expect(budgetDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Budget vs. Actual' }).first().click();
	await expect(page.getByRole('heading', { name: 'Budget vs. Actual' })).toBeVisible();
	await expect(page.getByRole('cell', { name: 'Groceries' })).toBeVisible();
	// Budgeted (100.00) and variance (also 100.00, since nothing was spent) both render the same
	// text — either match confirms the budgeted amount reached the report.
	await expect(page.getByRole('cell', { name: '100.00' }).first()).toBeVisible();
	await expect(page.getByText('Under')).toBeVisible();
});

test('a category with no budget for the selected month shows no data message', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('676784');
	await page.getByLabel('Confirm PIN').fill('676784');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Budgets', exact: true }).click();
	await page.getByRole('link', { name: 'Budget vs. Actual' }).first().click();
	await expect(page.getByText('No budgets or spend found for this period.')).toBeVisible();
});
