import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Polish (T097, SC-008): past VIRTUALIZE_THRESHOLD rows, the transaction list must only
// mount the rows within the scrolled viewport, not one <tr> per transaction.

test('the transaction list virtualizes rendering once the ledger is large', async ({ page }) => {
	const pin = '975386';
	const tmpDir = mkdtempSync(join(tmpdir(), 'myfin-e2e-'));
	const rowCount = 300;

	const lines = ['Date,Amount'];
	for (let i = 0; i < rowCount; i++) {
		const day = String((i % 27) + 1).padStart(2, '0');
		lines.push(`2026-01-${day},-1.00`);
	}
	const csvPath = join(tmpDir, 'many-transactions.csv');
	writeFileSync(csvPath, lines.join('\n') + '\n');

	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('100000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Import' }).click();
	await page.locator('input[type="file"]').setInputFiles(csvPath);
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Date column').click();
	await page.getByRole('option', { name: 'Date', exact: true }).click();
	await page.getByLabel('Amount column').click();
	await page.getByRole('option', { name: 'Amount', exact: true }).click();
	await page.getByRole('button', { name: /Import \d+ row/ }).click();
	await expect(page.getByText(`Created ${rowCount} unreviewed transaction`)).toBeVisible({
		timeout: 15000
	});

	await page.getByRole('link', { name: 'Transactions' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	// `.count()` doesn't auto-wait like other expect() matchers, so wait for the table to
	// actually have rendered its first row before reading a stable count from it.
	await expect(page.locator('table tbody tr').first()).toBeVisible();

	const dataRowCount = await page.locator('table tbody tr:not([aria-hidden="true"])').count();
	expect(dataRowCount).toBeLessThan(rowCount / 2);
	expect(dataRowCount).toBeGreaterThan(0);
});
