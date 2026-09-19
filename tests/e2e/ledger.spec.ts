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
		await onboard(page, '135784');

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
		await onboard(page, '222284');

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

	// spec 018, User Story 3 (FR-012/FR-013/FR-014): one consistent label rule (notes > merchant
	// > placeholder, never the bare type) applied identically on the transaction list, dashboard,
	// and review queue. Mirrors quickstart.md Scenario 3.
	test('transaction labels show notes/merchant/placeholder consistently, never the bare type', async ({
		page
	}) => {
		await onboard(page, '447712');

		await goTo(page, 'Accounts', 'Accounts');
		await addAccount(page, 'Checking', '1000');

		// Merchant-only, no notes, created via Quick Add so it lands unreviewed — the one
		// transaction we can check identically across all three surfaces (FR-014).
		await goTo(page, 'Quick Add', 'Quick Add');
		await page
			.getByLabel('Paste a payment notification')
			.fill('Rs.200.00 debited at Cafe Coffee Day');
		await page.getByRole('button', { name: 'Parse' }).click();
		await chooseOption(page, 'Account', 'Checking');
		await page.getByRole('button', { name: 'Confirm & add to review queue' }).click();
		await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();

		// Notes present, no merchant.
		await goTo(page, 'Transactions', 'Transactions');
		await page.getByRole('link', { name: 'New transaction' }).click();
		await chooseOption(page, 'Account', 'Checking');
		await page.getByLabel('Amount').fill('20');
		await page.getByLabel('Notes').fill('Split with roommate');
		await page.getByRole('button', { name: 'Save transaction' }).click();
		await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

		// Neither notes nor merchant.
		await page.getByRole('link', { name: 'New transaction' }).click();
		await chooseOption(page, 'Account', 'Checking');
		await page.getByLabel('Amount').fill('15');
		await page.getByRole('button', { name: 'Save transaction' }).click();
		await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

		// --- Transaction list: merchant name, notes, and the neutral placeholder — never "expense" ---
		await expect(page.getByText('Cafe Coffee Day')).toBeVisible();
		await expect(page.getByText('Split with roommate')).toBeVisible();
		await expect(page.getByText('Unlabeled transaction')).toBeVisible();

		// --- Dashboard: the exact same three labels ---
		await goTo(page, 'Dashboard', 'Dashboard');
		await expect(page.getByText('Cafe Coffee Day')).toBeVisible();
		await expect(page.getByText('Split with roommate')).toBeVisible();
		await expect(page.getByText('Unlabeled transaction')).toBeVisible();

		// --- Review Queue: only the Quick-Add transaction is unreviewed, and shows the same
		//     merchant-name label as everywhere else. `exact: true` avoids matching the
		//     Dashboard's own "Unreviewed N Transactions" link, which also contains "Review". ---
		await page.getByRole('link', { name: 'Review', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
		await expect(page.getByText('Cafe Coffee Day')).toBeVisible();
	});
});
