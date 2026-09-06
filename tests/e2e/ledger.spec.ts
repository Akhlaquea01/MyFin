import { test, expect, type Page } from '@playwright/test';

// User Story 2 (P2): the core ledger end-to-end — accounts, transactions, transfer,
// and soft-delete/restore via trash.
//
// Every nav-link click below is followed by a wait for that page's own heading. Client-
// side route transitions don't trigger a full-document navigation event, so a later
// locator could otherwise silently match stale content still on the previous page.

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

/** shadcn/Radix Select isn't a native <select> — open it and click the option instead. */
async function chooseOption(page: Page, comboboxLabel: string, optionName: string) {
	await page.getByLabel(comboboxLabel).click();
	await page.getByRole('option', { name: optionName, exact: true }).click();
}

async function addAccount(page: Page, name: string, openingBalance: string) {
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('heading', { name: 'New account' })).toBeVisible();
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Opening balance').fill(openingBalance);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

test.describe('Core Ledger', () => {
	test('create accounts, record transactions and a transfer, balances update correctly', async ({
		page
	}) => {
		await onboard(page, '1357');

		await goTo(page, 'Accounts', 'Accounts');
		await addAccount(page, 'Checking', '1000');
		await expect(page.getByText('Checking', { exact: true })).toBeVisible();

		await addAccount(page, 'Savings', '0');
		await expect(page.getByText('Savings', { exact: true })).toBeVisible();

		await goTo(page, 'Transactions', 'Transactions');
		await page.getByRole('link', { name: 'New transaction' }).click();
		await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
		await chooseOption(page, 'Account', 'Checking');
		await page.getByLabel('Amount').fill('150');
		await page.locator('input[type="date"]').fill('2026-01-15');
		await page.getByLabel('Notes').fill('Groceries');
		await page.getByRole('button', { name: 'Save transaction' }).click();
		await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
		await expect(page.getByText('Groceries')).toBeVisible();

		await page.getByRole('link', { name: 'Transfer' }).click();
		await expect(page.getByRole('heading', { name: 'Transfer Between Accounts' })).toBeVisible();
		await chooseOption(page, 'From', 'Checking');
		await chooseOption(page, 'To', 'Savings');
		await page.getByLabel('Amount').fill('200');
		await page.getByRole('button', { name: 'Transfer' }).click();
		await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

		await goTo(page, 'Accounts', 'Accounts');
		const checkingCard = page.locator('[data-slot="card"]').filter({ hasText: 'Checking' });
		await expect(checkingCard).toContainText('650.00'); // 1000 - 150 - 200
		const savingsCard = page.locator('[data-slot="card"]').filter({ hasText: 'Savings' });
		await expect(savingsCard).toContainText('200.00');
	});

	test('deleting a transaction moves it to trash, and restoring brings the balance back', async ({
		page
	}) => {
		await onboard(page, '2222');

		await goTo(page, 'Accounts', 'Accounts');
		await addAccount(page, 'Pocket Money', '500');
		await expect(page.getByText('Pocket Money', { exact: true })).toBeVisible();

		await goTo(page, 'Transactions', 'Transactions');
		await page.getByRole('link', { name: 'New transaction' }).click();
		await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
		await chooseOption(page, 'Account', 'Pocket Money');
		await page.getByLabel('Amount').fill('50');
		await page.getByLabel('Notes').fill('Snacks');
		await page.getByRole('button', { name: 'Save transaction' }).click();
		await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

		await page
			.getByRole('row', { name: /Snacks/ })
			.getByRole('button', { name: 'Delete' })
			.click();
		await expect(page.getByText('No transactions match.')).toBeVisible();

		await goTo(page, 'Trash', 'Trash');
		await expect(page.getByText('Snacks')).toBeVisible();
		await page.getByRole('button', { name: 'Restore' }).click();
		await expect(page.getByText('Nothing here.').first()).toBeVisible();

		await goTo(page, 'Transactions', 'Transactions');
		await expect(page.getByText('Snacks')).toBeVisible();
	});
});
