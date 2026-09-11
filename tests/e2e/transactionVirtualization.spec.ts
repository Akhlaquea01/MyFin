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
	// `.count()` doesn't auto-wait like other expect() matchers, so the table has to be
	// settled before it is read. Waiting on `table tbody tr` was not enough: the import
	// preview table is still mounted for a frame or two after the route swaps, and its five
	// preview rows satisfied the wait immediately — the count then ran against this page's
	// own first load and read 0. A spacer row exists only on a virtualized ledger table, and
	// React commits it in the same render as the rows it offsets, so waiting for one pins the
	// read to the right table *and* to the commit that rendered its rows.
	await expect(page.locator('table tbody tr[aria-hidden="true"]')).toHaveCount(1);

	const dataRowCount = await page.locator('table tbody tr:not([aria-hidden="true"])').count();
	expect(dataRowCount).toBeLessThan(rowCount / 2);
	expect(dataRowCount).toBeGreaterThan(0);
});
