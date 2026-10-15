import { test, expect, type Page } from '@playwright/test';

// Dates are validated before anything is stored (an emptied date input used to be saved as ""
// and dropped the entry out of every report), and "Check my data" re-adds the ledger.

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function chooseOption(page: Page, comboboxLabel: string, optionName: string) {
	await page.getByLabel(comboboxLabel).click();
	await page.getByRole('option', { name: optionName, exact: true }).click();
}

async function addAccount(page: Page, name: string, openingBalance: string) {
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Opening balance').fill(openingBalance);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

test('an empty date is refused with a message, and Check my data finds the ledger consistent', async ({
	page
}) => {
	await onboard(page, '135784');
	await page.getByRole('link', { name: 'Accounts' }).click();
	await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
	await addAccount(page, 'Checking', '1000');

	// New transaction: clearing the date shows why the form will not save.
	await page.goto('/transactions/new');
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await chooseOption(page, 'Account', 'Checking');
	await page.getByLabel('Amount').fill('150');
	await page.getByLabel('Notes').fill('Groceries');
	await page.locator('input[type="date"]').fill('');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByText('Enter a valid date.')).toBeVisible();

	await page.locator('input[type="date"]').fill('2026-01-15');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	await expect(page.getByText('Groceries')).toBeVisible();

	// Edit: an emptied date is refused and the entry keeps the one it had.
	await page.getByRole('button', { name: 'Edit transaction' }).first().click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Date').fill('');
	await dialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Enter a valid date.')).toBeVisible();
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByText('2026-01-15')).toBeVisible();

	// Check my data: one account, one entry, all consistent.
	await page.goto('/backup');
	await expect(page.getByRole('heading', { name: 'Backup & Restore' })).toBeVisible();
	await page.getByRole('button', { name: 'Check now' }).click();
	await expect(page.getByRole('status').filter({ hasText: 'All good' })).toContainText(
		'1 entries checked'
	);
});
