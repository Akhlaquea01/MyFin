import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A bank's statement export has the same layout every month. The import form used to start from
// nothing each time; now the columns and date format the user chose last time are filled in for a
// file with the same headers — never guessed, shown as remembered, and easy to discard.

const tmpDir = mkdtempSync(join(tmpdir(), 'myfin-e2e-'));

function csv(name: string, content: string): string {
	const path = join(tmpDir, name);
	writeFileSync(path, content);
	return path;
}

async function setUp(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Checking');
	await dialog.getByLabel('Opening balance').fill('1000');
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

/** Away and back, so the page starts from scratch like the next visit would. */
async function openImportFresh(page: Page) {
	await page.getByRole('link', { name: 'Dashboard' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await page.getByRole('link', { name: 'Import', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Import Transactions' })).toBeVisible();
}

async function pick(page: Page, label: string, option: string) {
	await page.getByLabel(label, { exact: true }).click();
	await page.getByRole('option', { name: option, exact: true }).click();
}

/** The mapping a user would make by hand for a "Txn Date / Narration / Debit / Credit" statement. */
async function mapStatementByHand(page: Page) {
	await pick(page, 'Account', 'Checking');
	await pick(page, 'Date column', 'Txn Date');
	await page.getByLabel('Date format').fill('DD/MM/YYYY');
	await pick(page, 'Description column (optional)', 'Narration');
	await pick(page, 'Amount convention', 'Separate debit/credit columns');
	await pick(page, 'Debit column', 'Debit');
	await pick(page, 'Credit column', 'Credit');
}

test('the next file with the same headers is already mapped — except the account', async ({
	page
}) => {
	await setUp(page, '606061');

	await openImportFresh(page);
	await page
		.locator('input[type="file"]')
		.setInputFiles(
			csv(
				'march.csv',
				'Txn Date,Narration,Debit,Credit\n05/03/2026,Rent,500.00,\n06/03/2026,Salary,,2000.00\n'
			)
		);
	// Nothing remembered yet: the form starts empty, as before.
	await expect(page.getByText(/filled in from the last time/)).toHaveCount(0);
	await mapStatementByHand(page);
	await page.getByRole('button', { name: /Import \d+ row/ }).click();
	await expect(page.getByText('Created 2 unreviewed transactions')).toBeVisible();
	await expect(page.getByText(/Column mapping remembered/)).toBeVisible();

	// A later statement — same layout, headers spelled a little differently.
	await openImportFresh(page);
	await page
		.locator('input[type="file"]')
		.setInputFiles(
			csv('april.csv', 'txn date,NARRATION,debit,credit\n14/04/2026,Groceries,80.00,\n')
		);
	await expect(page.getByText(/filled in from the last time/)).toBeVisible();
	await expect(page.getByLabel('Date format')).toHaveValue('DD/MM/YYYY');
	await expect(page.getByLabel('Date column')).toHaveText('txn date');
	await expect(page.getByLabel('Description column (optional)')).toHaveText('NARRATION');
	await expect(page.getByLabel('Amount convention')).toContainText('Separate debit/credit columns');
	await expect(page.getByLabel('Debit column')).toHaveText('debit');
	await expect(page.getByLabel('Credit column')).toHaveText('credit');

	// Which account a file belongs to is NOT remembered: it must be chosen, or the import waits.
	await expect(page.getByLabel('Account', { exact: true })).toContainText('Choose account');
	await expect(page.getByRole('button', { name: /Import \d+ row/ })).toBeDisabled();
	await pick(page, 'Account', 'Checking');
	await page.getByRole('button', { name: /Import \d+ row/ }).click();
	await expect(page.getByText('Created 1 unreviewed transaction')).toBeVisible();

	// The remembered format read the day-first date correctly.
	await page.getByRole('link', { name: 'Review', exact: true }).click();
	await expect(page.getByText('2026-04-14', { exact: false }).first()).toBeVisible();

	// A file with an extra column is a different layout: asked about again, not half-guessed.
	await openImportFresh(page);
	await page
		.locator('input[type="file"]')
		.setInputFiles(
			csv('with-ref.csv', 'Txn Date,Narration,Debit,Credit,Ref\n02/05/2026,Fuel,40.00,,R1\n')
		);
	await expect(page.getByText(/filled in from the last time/)).toHaveCount(0);
	await expect(page.getByLabel('Date column')).toContainText('Choose column');
});

test('a remembered mapping can be forgotten, and then stays forgotten', async ({ page }) => {
	await setUp(page, '606062');

	await openImportFresh(page);
	await page
		.locator('input[type="file"]')
		.setInputFiles(csv('first.csv', 'Txn Date,Narration,Debit,Credit\n05/03/2026,Rent,500.00,\n'));
	await mapStatementByHand(page);
	await page.getByRole('button', { name: /Import \d+ row/ }).click();
	await expect(page.getByText(/Column mapping remembered/)).toBeVisible();

	await openImportFresh(page);
	await page
		.locator('input[type="file"]')
		.setInputFiles(csv('second.csv', 'Txn Date,Narration,Debit,Credit\n06/03/2026,Gym,30.00,\n'));
	await expect(page.getByText(/filled in from the last time/)).toBeVisible();
	await page.getByRole('button', { name: 'Forget saved mapping' }).click();
	await expect(page.getByText(/filled in from the last time/)).toHaveCount(0);
	await expect(page.getByLabel('Date column')).toContainText('Choose column');

	await openImportFresh(page);
	await page
		.locator('input[type="file"]')
		.setInputFiles(csv('third.csv', 'Txn Date,Narration,Debit,Credit\n07/03/2026,Cinema,20.00,\n'));
	await expect(page.getByLabel('Date column')).toContainText('Choose column');
	await expect(page.getByText(/filled in from the last time/)).toHaveCount(0);
});

test('unticking "Remember" imports without saving the mapping', async ({ page }) => {
	await setUp(page, '606063');

	await openImportFresh(page);
	await page
		.locator('input[type="file"]')
		.setInputFiles(csv('once.csv', 'Txn Date,Narration,Debit,Credit\n05/03/2026,Rent,500.00,\n'));
	await mapStatementByHand(page);
	await page.getByLabel(/Remember these columns/).uncheck();
	await page.getByRole('button', { name: /Import \d+ row/ }).click();
	await expect(page.getByText('Created 1 unreviewed transaction')).toBeVisible();
	await expect(page.getByText(/Column mapping remembered/)).toHaveCount(0);

	await openImportFresh(page);
	await page
		.locator('input[type="file"]')
		.setInputFiles(csv('again.csv', 'Txn Date,Narration,Debit,Credit\n06/03/2026,Gym,30.00,\n'));
	await expect(page.getByText(/filled in from the last time/)).toHaveCount(0);
	await expect(page.getByLabel('Date column')).toContainText('Choose column');
});
