import { test, expect, type Page } from '@playwright/test';

// The Categories page: where the month's money went, and keeping the list tidy — rename, recolour,
// merge, and delete without losing what is filed under a category.

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

async function addCategory(page: Page, name: string) {
	await goTo(page, 'Categories', 'Categories');
	await page.getByRole('button', { name: 'Add category' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
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
	await addCategory(page, 'Dining');
}

/** Spends today, filed under `category`, so it falls in the month the page opens on. */
async function spend(page: Page, amount: string, category: string) {
	await goTo(page, 'Transactions', 'Transactions');
	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill(amount);
	await page.locator('button[role="combobox"]').filter({ hasText: 'Category…' }).click();
	await page.getByRole('option', { name: category, exact: true }).click();
	await page.locator('input[placeholder="Amount"]').fill(amount);
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
}

/** A category's card, found by its own Edit button (the summary card above also mentions names). */
function card(page: Page, name: string) {
	return page
		.locator('[data-slot="card"]')
		.filter({ has: page.getByRole('button', { name: `Edit ${name}`, exact: true }) })
		.first();
}

test('the page totals the month and shows each category with its spend', async ({ page }) => {
	await setUp(page, '552211');
	await spend(page, '40', 'Food');
	await spend(page, '25', 'Dining');

	await goTo(page, 'Categories', 'Categories');
	await expect(page.getByText(/Spent in /)).toBeVisible();
	await expect(page.getByText('₹65.00', { exact: true })).toBeVisible(); // the month's total
	await expect(card(page, 'Food').getByText('₹40.00')).toBeVisible();
	await expect(card(page, 'Dining').getByText('₹25.00')).toBeVisible();

	// Biggest first, and the search narrows the list.
	await page.getByPlaceholder('Search').fill('din');
	await expect(page.getByRole('button', { name: 'Edit Dining' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Edit Food' })).toHaveCount(0);
});

test('a category can be renamed, recoloured and given an icon', async ({ page }) => {
	await setUp(page, '552212');
	await goTo(page, 'Categories', 'Categories');

	await page.getByRole('button', { name: 'Edit Food' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Groceries & Food');
	await dialog.getByRole('radio', { name: 'Colour 3' }).click();
	await dialog.getByRole('radio', { name: 'Icon Groceries' }).click();
	await dialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(dialog).not.toBeVisible();

	await expect(page.getByRole('button', { name: 'Edit Groceries & Food' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Edit Food', exact: true })).toHaveCount(0);

	// The choices were kept.
	await page.getByRole('button', { name: 'Edit Groceries & Food' }).click();
	await expect(page.getByRole('dialog').getByLabel('Name')).toHaveValue('Groceries & Food');
	await expect(page.getByRole('dialog').getByRole('radio', { name: 'Colour 3' })).toHaveAttribute(
		'aria-checked',
		'true'
	);
	await expect(
		page.getByRole('dialog').getByRole('radio', { name: 'Icon Groceries' })
	).toHaveAttribute('aria-checked', 'true');
});

test('merging a category moves its transactions into the one chosen', async ({ page }) => {
	await setUp(page, '552213');
	await spend(page, '40', 'Food');
	await spend(page, '25', 'Dining');

	await goTo(page, 'Categories', 'Categories');
	await page.getByRole('button', { name: 'More actions for Food' }).click();
	await page.getByRole('menuitem', { name: 'Merge into…' }).click();
	const dialog = page.getByRole('dialog');
	await expect(
		dialog.getByRole('heading', { name: 'Merge Food into another category' })
	).toBeVisible();
	// A merge needs a destination.
	await expect(dialog.getByRole('button', { name: 'Merge categories' })).toBeDisabled();
	await dialog.getByLabel('Merge into').click();
	await page.getByRole('option', { name: 'Dining', exact: true }).click();
	await dialog.getByRole('button', { name: 'Merge categories' }).click();
	await expect(dialog).not.toBeVisible();

	await expect(page.getByText('Food merged into Dining')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Edit Food' })).toHaveCount(0);
	await expect(card(page, 'Dining').getByText('₹65.00')).toBeVisible();
});

test('deleting a category that has transactions asks where they go, and keeps them', async ({
	page
}) => {
	await setUp(page, '552214');
	await spend(page, '40', 'Food');

	await goTo(page, 'Categories', 'Categories');
	await page.getByRole('button', { name: 'Delete Food' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('heading', { name: 'Remove Food' })).toBeVisible();
	await expect(dialog.getByText('1 transaction')).toBeVisible();
	await dialog.getByRole('button', { name: 'Remove category' }).click();
	await expect(dialog).not.toBeVisible();

	await expect(
		page.getByText(/Food deleted\. 1 transaction moved to Uncategorized\./)
	).toBeVisible();
	await expect(page.getByRole('button', { name: 'Edit Food' })).toHaveCount(0);
	// The money is still there, now under Uncategorized.
	await expect(
		page.locator('[data-slot="card"]').filter({ hasText: 'transaction to sort' })
	).toContainText('₹40.00');
	await expect(page.getByText('1 with no category')).toBeVisible();
});

test('an empty list offers the common categories', async ({ page }) => {
	await onboard(page, '552215');
	await goTo(page, 'Categories', 'Categories');
	await expect(page.getByText('No categories yet')).toBeVisible();
	await page.getByRole('button', { name: 'Start with the common ones' }).click();
	await expect(page.getByRole('button', { name: 'Edit Food & Dining' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Edit Groceries' })).toBeVisible();

	// Salary is an income category, so it is on the Income list rather than under Spending.
	await expect(page.getByRole('button', { name: 'Edit Salary' })).toHaveCount(0);
	await page.getByRole('radio', { name: 'Income' }).click();
	await expect(page.getByRole('button', { name: 'Edit Salary' })).toBeVisible();
});
