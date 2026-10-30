import { test, expect, type Page } from '@playwright/test';
import { acceptConfirm, dismissConfirm } from './helpers';

// The Transactions list: filter by amount (also inside a saved view), and act on several entries
// at once.

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

async function addExpense(page: Page, amount: string, notes: string) {
	await page.goto('/transactions/new');
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill(amount);
	await page.getByLabel('Notes').fill(notes);
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
}

async function setUp(page: Page, pin: string) {
	await onboard(page, pin);
	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Checking');
	await dialog.getByLabel('Opening balance').fill('10000');
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();

	await goTo(page, 'Categories', 'Categories');
	await page.getByRole('button', { name: 'Add category' }).click();
	const category = page.getByRole('dialog');
	await category.getByLabel('Name').fill('Eating out');
	await category.getByRole('button', { name: 'Add category' }).click();
	await expect(category).not.toBeVisible();

	await addExpense(page, '120', 'Dinner');
	await addExpense(page, '450', 'Fuel');
	await addExpense(page, '2500', 'Rent');
	await goTo(page, 'Transactions', 'Transactions');
}

const row = (page: Page, text: string) => page.getByRole('row').filter({ hasText: text });

test('filters by amount, rejects a bad amount, and keeps the range in a saved view', async ({
	page
}) => {
	await setUp(page, '626201');
	await expect(row(page, 'Dinner')).toHaveCount(1);

	await page.getByLabel('Min amount').fill('400');
	await page.getByRole('button', { name: 'Filter' }).click();
	await expect(row(page, 'Dinner')).toHaveCount(0);
	await expect(row(page, 'Fuel')).toHaveCount(1);
	await expect(row(page, 'Rent')).toHaveCount(1);

	await page.getByLabel('Max amount').fill('500');
	await page.getByRole('button', { name: 'Filter' }).click();
	await expect(row(page, 'Rent')).toHaveCount(0);
	await expect(row(page, 'Fuel')).toHaveCount(1);

	// Something that is not an amount is reported, and the list is left alone.
	await page.getByLabel('Min amount').fill('abc');
	await page.getByRole('button', { name: 'Filter' }).click();
	await expect(page.getByText('Enter the minimum amount as a number')).toBeVisible();
	await expect(row(page, 'Fuel')).toHaveCount(1);
	await page.getByLabel('Min amount').fill('400');

	// The range is part of what a saved view remembers.
	await page.getByRole('button', { name: 'Save View' }).click();
	await page.getByLabel('View Name').fill('Mid-size');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('View saved successfully.')).toBeVisible();

	await page.getByLabel('Min amount').fill('');
	await page.getByLabel('Max amount').fill('');
	await page.getByRole('button', { name: 'Filter' }).click();
	await expect(row(page, 'Dinner')).toHaveCount(1);
	await expect(row(page, 'Rent')).toHaveCount(1);

	await page.getByRole('button', { name: 'Saved Views' }).click();
	await page.getByRole('menuitem', { name: 'Mid-size' }).click();
	await expect(page.getByLabel('Min amount')).toHaveValue('400.00');
	await expect(page.getByLabel('Max amount')).toHaveValue('500.00');
	await expect(row(page, 'Fuel')).toHaveCount(1);
	await expect(row(page, 'Dinner')).toHaveCount(0);
	await expect(row(page, 'Rent')).toHaveCount(0);
});

test('sets one category on several entries at once', async ({ page }) => {
	await setUp(page, '626202');

	await page.getByRole('checkbox', { name: /Select transaction Dinner/ }).check();
	await page.getByRole('checkbox', { name: /Select transaction Fuel/ }).check();
	const bar = page.getByRole('region', { name: 'Bulk actions' });
	await expect(bar).toContainText('2 selected');

	await bar.getByRole('button', { name: 'Set category' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toContainText('Set category for 2 transactions');
	await dialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Eating out', exact: true }).click();
	await dialog.getByRole('button', { name: 'Apply' }).click();

	await expect(page.getByText('Updated 2 transactions.')).toBeVisible();
	await expect(bar).not.toBeVisible();
	await expect(row(page, 'Dinner')).toContainText('Eating out');
	await expect(row(page, 'Fuel')).toContainText('Eating out');
	await expect(row(page, 'Rent')).not.toContainText('Eating out');
});

test('deletes several entries after one confirmation, and only those', async ({ page }) => {
	await setUp(page, '626203');

	await page.getByRole('checkbox', { name: /Select transaction Dinner/ }).check();
	await page.getByRole('checkbox', { name: /Select transaction Fuel/ }).check();
	const bar = page.getByRole('region', { name: 'Bulk actions' });

	// Backing out deletes nothing and keeps the selection.
	await bar.getByRole('button', { name: 'Delete' }).click();
	await dismissConfirm(page, 'Delete 2 transactions');
	await expect(row(page, 'Dinner')).toHaveCount(1);
	await expect(bar).toContainText('2 selected');

	await bar.getByRole('button', { name: 'Delete' }).click();
	await acceptConfirm(page, 'This cannot be undone');
	await expect(page.getByText('Deleted 2 transactions.')).toBeVisible();
	await expect(row(page, 'Dinner')).toHaveCount(0);
	await expect(row(page, 'Fuel')).toHaveCount(0);
	await expect(row(page, 'Rent')).toHaveCount(1);
	await expect(bar).not.toBeVisible();

	// The balance followed: 10,000 opening less the 2,500 that is left.
	await goTo(page, 'Accounts', 'Accounts');
	await expect(page.getByText('₹7,500.00').first()).toBeVisible();
});

test('select-all picks every entry on the list and clears again', async ({ page }) => {
	await setUp(page, '626204');

	await page.getByRole('checkbox', { name: 'Select all transactions' }).check();
	await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText('3 selected');

	await page.getByRole('checkbox', { name: 'Select all transactions' }).uncheck();
	await expect(page.getByRole('region', { name: 'Bulk actions' })).not.toBeVisible();
});
