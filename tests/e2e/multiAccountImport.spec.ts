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

// spec 018, User Story 2 (FR-007-FR-011): the "Copy reconciliation prompt" button never
// navigates and never touches existing data, and a CSV shaped like the prompt's contract rides
// the existing (unmodified) ±1-day/same-amount duplicate flagging — created but flagged, not
// blocked or silently re-imported — with Discard/Confirm behaving exactly as they already do.
// Mirrors quickstart.md Scenario 2.
test('reconciliation prompt copies without navigating, and a reconciliation-shaped CSV rides existing duplicate flagging (Scenario: reconciliation)', async ({
	page
}) => {
	await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	const tmpDir = mkdtempSync(join(tmpdir(), 'myfin-e2e-'));
	await setUpAppWithAccounts(page, ['Checking', 'Savings']);

	await page.getByRole('link', { name: 'Import' }).click();
	await expect(page.getByRole('heading', { name: 'Import Transactions' })).toBeVisible();

	// --- Copy action: no file needed, no navigation, no existing-data reference (FR-007/FR-011) ---
	await page.getByRole('button', { name: 'Copy reconciliation prompt' }).click();
	await expect(page.getByText(/Reconciliation prompt copied/)).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Import Transactions' })).toBeVisible();
	const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
	expect(clipboardText).toContain('Date,Description,Amount');
	expect(clipboardText).toContain('YYYY-MM-DD');
	expect(clipboardText.toLowerCase()).not.toContain('checking');
	expect(clipboardText.toLowerCase()).not.toContain('savings');

	// --- Seed one already-recorded transaction on Checking (simulates a transaction the user
	//     entered before reconciling) ---
	const seedCsv = join(tmpDir, 'seed.csv');
	writeFileSync(seedCsv, 'Date,Description,Amount\n2026-01-15,Groceries,-40.00\n');
	await page.locator('input[type="file"]').setInputFiles(seedCsv);
	await page.getByLabel('Account', { exact: true }).click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Date column').click();
	await page.getByRole('option', { name: 'Date', exact: true }).click();
	await page.getByLabel('Amount column').click();
	await page.getByRole('option', { name: 'Amount', exact: true }).click();
	await page.getByLabel('Description column (optional)').click();
	await page.getByRole('option', { name: 'Description', exact: true }).click();
	await page.getByRole('button', { name: /Import \d+ row/ }).click();
	await expect(page.getByText('Created 1 unreviewed transaction')).toBeVisible();

	// --- Import a CSV shaped exactly per the reconciliation prompt's contract, with two rows
	//     that duplicate the seeded transaction's date+amount and one clean new row ---
	const reconciliationCsv = join(tmpDir, 'reconciliation.csv');
	writeFileSync(
		reconciliationCsv,
		'Date,Description,Amount\n' +
			'2026-01-15,Grocery Store,-40.00\n' +
			'2026-01-15,Refund Correction,-40.00\n' +
			'2026-01-20,Rent,-500.00\n'
	);
	await page.getByRole('link', { name: 'Import' }).click();
	await page.locator('input[type="file"]').setInputFiles(reconciliationCsv);
	await page.getByLabel('Account', { exact: true }).click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Date column').click();
	await page.getByRole('option', { name: 'Date', exact: true }).click();
	await page.getByLabel('Amount column').click();
	await page.getByRole('option', { name: 'Amount', exact: true }).click();
	await page.getByLabel('Description column (optional)').click();
	await page.getByRole('option', { name: 'Description', exact: true }).click();
	await page.getByRole('button', { name: /Import \d+ row/ }).click();
	await expect(page.getByText('Created 3 unreviewed transactions')).toBeVisible();

	// --- Review Queue: both overlapping rows are created AND flagged (not blocked, not silently
	//     re-imported); the clean row and the original seed are not flagged (FR-010) ---
	await page.getByRole('link', { name: 'Review', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();

	const groceries = page.locator('[data-slot="card"]').filter({ hasText: 'Groceries' });
	const groceryStore = page.locator('[data-slot="card"]').filter({ hasText: 'Grocery Store' });
	const refundCorrection = page
		.locator('[data-slot="card"]')
		.filter({ hasText: 'Refund Correction' });
	const rent = page.locator('[data-slot="card"]').filter({ hasText: 'Rent' });

	await expect(groceries.getByText('Possible duplicate')).toHaveCount(0);
	await expect(groceryStore.getByText('Possible duplicate')).toBeVisible();
	await expect(refundCorrection.getByText('Possible duplicate')).toBeVisible();
	await expect(rent.getByText('Possible duplicate')).toHaveCount(0);

	// --- Discard a flagged duplicate: it disappears, the original it duplicated is untouched
	//     (acceptance scenario 4) ---
	await groceryStore.getByRole('button', { name: 'Discard transaction' }).click();
	await expect(groceryStore).toHaveCount(0);
	await expect(groceries).toBeVisible();

	// --- A flagged item that is actually NOT a duplicate can be kept via Confirm, and still
	//     counts independently afterward (spec Edge Cases) ---
	await refundCorrection.getByRole('button', { name: 'Confirm transaction' }).click();
	await expect(refundCorrection).toHaveCount(0);
	await page.getByRole('link', { name: 'Transactions', exact: true }).click();
	await expect(page.getByText('Refund Correction')).toBeVisible();

	// --- A brand-new account with zero existing transactions imports cleanly with nothing
	//     flagged (spec Edge Cases) ---
	await page.getByRole('link', { name: 'Import' }).click();
	const freshCsv = join(tmpDir, 'fresh.csv');
	writeFileSync(freshCsv, 'Date,Description,Amount\n2026-01-15,First Deposit,1000.00\n');
	await page.locator('input[type="file"]').setInputFiles(freshCsv);
	await page.getByLabel('Account', { exact: true }).click();
	await page.getByRole('option', { name: 'Savings', exact: true }).click();
	await page.getByLabel('Date column').click();
	await page.getByRole('option', { name: 'Date', exact: true }).click();
	await page.getByLabel('Amount column').click();
	await page.getByRole('option', { name: 'Amount', exact: true }).click();
	await page.getByLabel('Description column (optional)').click();
	await page.getByRole('option', { name: 'Description', exact: true }).click();
	await page.getByRole('button', { name: /Import \d+ row/ }).click();
	await expect(page.getByText('Created 1 unreviewed transaction')).toBeVisible();

	await page.getByRole('link', { name: 'Review', exact: true }).click();
	await expect(
		page
			.locator('[data-slot="card"]')
			.filter({ hasText: 'First Deposit' })
			.getByText('Possible duplicate')
	).toHaveCount(0);
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
