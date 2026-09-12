import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// User Story 9 (P9): CSV import, export, backup, restore, and corrupted-backup rejection.

test('CSV import, export, backup, and restore round trip; a corrupted backup is rejected', async ({
	page
}) => {
	const pin = '468035';
	const tmpDir = mkdtempSync(join(tmpdir(), 'myfin-e2e-'));

	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('1000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	// --- CSV import ---
	const csvPath = join(tmpDir, 'transactions.csv');
	writeFileSync(csvPath, 'Date,Description,Amount\n2026-01-15,Groceries,-40.00\n');

	await page.getByRole('link', { name: 'Import' }).click();
	await expect(page.getByRole('heading', { name: 'Import Transactions' })).toBeVisible();
	// setInputFiles sets the file directly without triggering a native file-picker dialog.
	await page.locator('input[type="file"]').setInputFiles(csvPath);

	await page.getByLabel('Account', { exact: true }).click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await expect(page.getByRole('columnheader', { name: 'Date' })).toBeVisible();

	await page.getByLabel('Date column').click();
	await page.getByRole('option', { name: 'Date', exact: true }).click();
	await page.getByLabel('Amount column').click();
	await page.getByRole('option', { name: 'Amount', exact: true }).click();

	await page.getByRole('button', { name: /Import \d+ row/ }).click();
	await expect(page.getByText('Created 1 unreviewed transaction')).toBeVisible();

	// --- CSV export ---
	await page.getByRole('link', { name: 'Export' }).click();
	await expect(page.getByRole('heading', { name: 'Export Transactions' })).toBeVisible();
	const [exportDownload] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Export as CSV' }).click()
	]);
	expect(exportDownload.suggestedFilename()).toMatch(/^myfin-transactions-.*\.csv$/);

	// --- Backup ---
	await page.getByRole('link', { name: 'Backup' }).click();
	await expect(page.getByRole('heading', { name: 'Backup & Restore' })).toBeVisible();
	await page.getByLabel('Confirm your PIN').fill(pin);
	const [backupDownload] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Create backup now' }).click()
	]);
	const backupPath = join(tmpDir, 'backup.json');
	await backupDownload.saveAs(backupPath);

	// --- Corrupted backup is rejected without touching existing data ---
	const backupFile = JSON.parse(readFileSync(backupPath, 'utf-8'));
	const corruptedPath = join(tmpDir, 'corrupted-backup.json');
	writeFileSync(corruptedPath, JSON.stringify({ ...backupFile, checksum: '0'.repeat(64) }));

	await page.getByLabel('Backup PIN').fill(pin);
	await page.locator('input[type="file"]').setInputFiles(corruptedPath);
	await expect(page.getByText('Incorrect PIN or corrupted backup file.')).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await expect(page.getByText('Checking', { exact: true })).toBeVisible();

	// --- Legitimate restore ---
	await page.getByRole('link', { name: 'Backup' }).click();
	await page.getByLabel('Backup PIN').fill(pin);
	await page.locator('input[type="file"]').setInputFiles(backupPath);

	// Nothing is written until the wipe is confirmed explicitly (Constitution Principle VI).
	const confirmDialog = page.getByRole('dialog');
	await expect(confirmDialog.getByText('Replace all data on this device?')).toBeVisible({
		timeout: 15000
	});
	await confirmDialog.getByLabel('Type REPLACE to confirm').fill('REPLACE');
	await confirmDialog.getByRole('button', { name: 'Replace everything' }).click();

	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible({
		timeout: 15000
	});
	await page.getByLabel('PIN').fill(pin);
	await page.getByRole('button', { name: 'Unlock' }).click();
	// The reload preserves the current URL, so unlocking lands back on Backup & Restore
	// (the route that was active before the restore), not the dashboard.
	await expect(page.getByRole('heading', { name: 'Backup & Restore' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await expect(page.getByText('Checking', { exact: true })).toBeVisible();
});
