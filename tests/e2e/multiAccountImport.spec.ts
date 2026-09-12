import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Spec 009: Multi-Account Transaction Import — quickstart.md Scenarios 1, 2, 3, 5.

async function setUpAppWithAccounts(page: import('@playwright/test').Page, accountNames: string[]) {
	const pin = '925814';
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	for (const name of accountNames) {
		await page.getByRole('button', { name: 'Add account' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Name').fill(name);
		await dialog.getByLabel('Opening balance').fill('1000');
		await dialog.getByRole('button', { name: 'Add account' }).click();
		await expect(dialog).not.toBeVisible();
	}
}

test('imports one file covering multiple accounts, with a per-account result breakdown (Scenario 1)', async ({
	page
}) => {
	const tmpDir = mkdtempSync(join(tmpdir(), 'myfin-e2e-'));
	await setUpAppWithAccounts(page, ['Checking', 'Savings']);

	const csvPath = join(tmpDir, 'multi-account.csv');
	writeFileSync(
		csvPath,
		'Date,Description,Amount,Account\n' +
			'2026-01-15,Groceries,-40.00,Checking\n' +
			'2026-01-16,Paycheck,2000.00,Checking\n' +
			'2026-01-17,ATM,-50.00,Savings\n'
	);

	await page.getByRole('link', { name: 'Import' }).click();
	await expect(page.getByRole('heading', { name: 'Import Transactions' })).toBeVisible();
	await page.locator('input[type="file"]').setInputFiles(csvPath);

	await page.getByLabel('Date column').click();
	await page.getByRole('option', { name: 'Date', exact: true }).click();
	await page.getByLabel('Amount column').click();
	await page.getByRole('option', { name: 'Amount', exact: true }).click();
	await page.getByLabel('Account column (optional)').click();
	await page.getByRole('option', { name: 'Account', exact: true }).click();

	// Preview shows the resolved account per row before anything is imported.
	await expect(page.getByRole('columnheader', { name: 'Account (resolved)' })).toBeVisible();
	await expect(page.getByRole('cell', { name: '✅ Checking' }).first()).toBeVisible();
	await expect(page.getByRole('cell', { name: '✅ Savings' })).toBeVisible();

	await page.getByRole('button', { name: /Import \d+ row/ }).click();
	await expect(page.getByText('Created 3 unreviewed transactions')).toBeVisible();
	await expect(page.getByText('2 to Checking')).toBeVisible();
	await expect(page.getByText('1 to Savings')).toBeVisible();
});

test('a file with no account column behaves exactly as before (Scenario 2)', async ({ page }) => {
	const tmpDir = mkdtempSync(join(tmpdir(), 'myfin-e2e-'));
	await setUpAppWithAccounts(page, ['Checking']);

	const csvPath = join(tmpDir, 'single-account.csv');
	writeFileSync(csvPath, 'Date,Description,Amount\n2026-01-15,Groceries,-40.00\n');

	await page.getByRole('link', { name: 'Import' }).click();
	await page.locator('input[type="file"]').setInputFiles(csvPath);

	await page.getByLabel('Account', { exact: true }).click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Date column').click();
	await page.getByRole('option', { name: 'Date', exact: true }).click();
	await page.getByLabel('Amount column').click();
	await page.getByRole('option', { name: 'Amount', exact: true }).click();

	await page.getByRole('button', { name: /Import \d+ row/ }).click();
	await expect(page.getByText('Created 1 unreviewed transaction')).toBeVisible();
	// No per-account breakdown for a single-account import.
	await expect(page.getByText('Imported by account:')).not.toBeVisible();
});

test('blank and unresolved account values are flagged and excluded, not silently imported (Scenario 3)', async ({
	page
}) => {
	const tmpDir = mkdtempSync(join(tmpdir(), 'myfin-e2e-'));
	await setUpAppWithAccounts(page, ['Checking']);

	const csvPath = join(tmpDir, 'mixed-validity.csv');
	writeFileSync(
		csvPath,
		'Date,Description,Amount,Account\n' +
			'2026-01-15,Groceries,-40.00,Checking\n' +
			'2026-01-16,Blank Account,-10.00,\n' +
			'2026-01-17,Typo Account,-20.00,Chekcing\n'
	);

	await page.getByRole('link', { name: 'Import' }).click();
	await page.locator('input[type="file"]').setInputFiles(csvPath);

	await page.getByLabel('Date column').click();
	await page.getByRole('option', { name: 'Date', exact: true }).click();
	await page.getByLabel('Amount column').click();
	await page.getByRole('option', { name: 'Amount', exact: true }).click();
	await page.getByLabel('Account column (optional)').click();
	await page.getByRole('option', { name: 'Account', exact: true }).click();

	await expect(page.getByRole('cell', { name: '❌ Empty' })).toBeVisible();
	await expect(page.getByRole('cell', { name: '❌ Chekcing (not found)' })).toBeVisible();

	await page.getByRole('button', { name: /Import \d+ row/ }).click();
	await expect(page.getByText('Created 1 unreviewed transaction')).toBeVisible();
	await expect(page.getByText("2 rows couldn't be read:")).toBeVisible();
	await expect(page.getByText('Account column is empty.')).toBeVisible();
	await expect(page.getByText('Account "Chekcing" not found.')).toBeVisible();
});

test('a duplicated account name blocks the entire import (Scenario 5)', async ({ page }) => {
	const tmpDir = mkdtempSync(join(tmpdir(), 'myfin-e2e-'));
	// Two accounts named "Checking" — the app does not prevent this today.
	await setUpAppWithAccounts(page, ['Checking', 'Checking', 'Savings']);

	const csvPath = join(tmpDir, 'colliding-name.csv');
	writeFileSync(
		csvPath,
		'Date,Description,Amount,Account\n' +
			'2026-01-15,Groceries,-40.00,Checking\n' +
			'2026-01-16,ATM,-50.00,Savings\n'
	);

	await page.getByRole('link', { name: 'Import' }).click();
	await page.locator('input[type="file"]').setInputFiles(csvPath);

	await page.getByLabel('Date column').click();
	await page.getByRole('option', { name: 'Date', exact: true }).click();
	await page.getByLabel('Amount column').click();
	await page.getByRole('option', { name: 'Amount', exact: true }).click();
	await page.getByLabel('Account column (optional)').click();
	await page.getByRole('option', { name: 'Account', exact: true }).click();

	await expect(
		page.getByText('Account name "Checking" matches more than one account.')
	).toBeVisible();
	await expect(page.getByRole('button', { name: /Import \d+ row/ })).toBeDisabled();
});
