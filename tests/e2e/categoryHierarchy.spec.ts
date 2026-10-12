import { test, expect, type Page } from '@playwright/test';
import { acceptConfirm } from './helpers';

// Categories are a tree: a budget on a parent covers its subcategories, pickers and charts show the
// full path, and a parent can't be deleted out from under its children.

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

async function addCategory(page: Page, name: string, parent?: string) {
	await goTo(page, 'Categories', 'Categories');
	await page.getByRole('button', { name: 'Add category' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	if (parent) {
		await dialog.getByLabel('Parent (optional)').click();
		await page.getByRole('option', { name: parent, exact: true }).click();
	}
	await dialog.getByRole('button', { name: 'Add category' }).click();
	await expect(dialog).not.toBeVisible();
}

async function setUp(page: Page, pin: string) {
	await onboard(page, pin);
	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('5000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await addCategory(page, 'Food');
	await addCategory(page, 'Travel');
	await addCategory(page, 'Groceries', 'Food');
	await addCategory(page, 'Other', 'Food');
	await addCategory(page, 'Other', 'Travel');
}

test('a budget on a parent counts spending in its subcategories', async ({ page }) => {
	await setUp(page, '141421');

	await goTo(page, 'Budgets', 'Budgets');
	await page.getByRole('button', { name: 'Add budget' }).click();
	const budgetDialog = page.getByRole('dialog');
	await budgetDialog.getByLabel('Category').click();
	// Both "Other" subcategories can be told apart in the picker, with children under their parents.
	await expect(page.getByRole('option', { name: 'Food › Other', exact: true })).toHaveCount(1);
	await expect(page.getByRole('option', { name: 'Travel › Other', exact: true })).toHaveCount(1);
	await page.getByRole('option', { name: 'Food', exact: true }).click();
	await budgetDialog.getByLabel('Amount', { exact: true }).fill('100');
	await budgetDialog.getByRole('button', { name: 'Add budget' }).click();
	await expect(budgetDialog).not.toBeVisible();

	const budgetCard = page.locator('[data-slot="card"]').filter({ hasText: 'of ₹100.00' });
	await expect(budgetCard.getByText('Includes 2 subcategories')).toBeVisible();

	// Spend filed under a SUBcategory.
	await goTo(page, 'Transactions', 'Transactions');
	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('40');
	await page.locator('button[role="combobox"]').filter({ hasText: 'Category…' }).click();
	await page.getByRole('option', { name: 'Food › Groceries', exact: true }).click();
	await page.locator('input[placeholder="Amount"]').fill('40');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	// …and the list names it by its path.
	await expect(
		page.getByRole('row').filter({ hasText: '-₹40.00' }).getByText('Food › Groceries')
	).toBeVisible();

	await goTo(page, 'Budgets', 'Budgets');
	const updated = page.locator('[data-slot="card"]').filter({ hasText: 'of ₹100.00' });
	await expect(updated.getByText('₹40.00', { exact: true }).first()).toBeVisible();
});

test('a parent with subcategories cannot be deleted until they are gone', async ({ page }) => {
	await setUp(page, '141422');
	await goTo(page, 'Categories', 'Categories');

	await page.getByRole('button', { name: 'Delete Food' }).click();
	await expect(page.getByText(/Food still has 2 subcategories \(.*Groceries.*\)/)).toBeVisible();
	await expect(page.getByRole('button', { name: 'Delete Groceries' })).toBeVisible(); // still there

	// A category with nothing under it is deleted as before…
	await page.getByRole('button', { name: 'Delete Groceries' }).click();
	await acceptConfirm(page);
	await expect(page.getByRole('button', { name: 'Delete Groceries' })).toHaveCount(0);

	// …and once only one subcategory is left, the message says so.
	await page.getByRole('button', { name: 'Delete Food' }).click();
	await expect(page.getByText(/Food still has 1 subcategory \(Other\)/)).toBeVisible();
});

test('analytics labels subcategories by path and can group them under their parent', async ({
	page
}) => {
	await setUp(page, '141423');
	await goTo(page, 'Transactions', 'Transactions');
	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('75');
	await page.locator('button[role="combobox"]').filter({ hasText: 'Category…' }).click();
	await page.getByRole('option', { name: 'Food › Other', exact: true }).click();
	await page.locator('input[placeholder="Amount"]').fill('75');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await goTo(page, 'Analytics', 'Analytics');
	const chart = page.getByRole('img', { name: /Bar chart of spending by category/ });
	await expect(chart).toHaveAttribute('aria-label', /Food › Other ₹75\.00/);

	await page.getByLabel('Group subcategories under their parent').check();
	await expect(chart).toHaveAttribute('aria-label', /category: Food ₹75\.00/);
	await page.getByLabel('Group subcategories under their parent').uncheck();
	await expect(chart).toHaveAttribute('aria-label', /Food › Other ₹75\.00/);
});

test('the roll-up option is not offered when there are no subcategories', async ({ page }) => {
	await onboard(page, '141424');
	await addCategory(page, 'Groceries');
	await goTo(page, 'Analytics', 'Analytics');
	await expect(page.getByLabel('Group subcategories under their parent')).toHaveCount(0);
});
