import { test, expect } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Data Template export and import round trip', async ({ page }) => {
	const pin = '951234';
	const tmpDir = mkdtempSync(join(tmpdir(), 'myfin-template-e2e-'));

	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	// Create an account
	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Vacation Savings');
	await accountDialog.getByLabel('Opening balance').fill('500');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	// Go to Export page
	await page.getByRole('link', { name: 'Export' }).click();
	await expect(page.getByRole('heading', { name: 'Export Transactions' })).toBeVisible();

	// Export Data Template (JSON)
	const [exportDownload] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Export Template (JSON)' }).click()
	]);
	expect(exportDownload.suggestedFilename()).toMatch(/^myfin-template-.*\.json$/);

	const downloadedPath = join(tmpDir, exportDownload.suggestedFilename());
	await exportDownload.saveAs(downloadedPath);

	const fileContent = readFileSync(downloadedPath, 'utf8');
	const parsed = JSON.parse(fileContent);
	expect(parsed.container).toBe('myfin-data-template');
	expect(parsed.entities.accounts.some((a: { name: string }) => a.name === 'Vacation Savings')).toBe(true);

	// Import the exported file back in (overlapping import)
	const fileInput = page.locator('input[type="file"][accept*="json"]');
	await fileInput.setInputFiles(downloadedPath);

	// Summary dialog should display
	const summaryDialog = page.getByRole('dialog');
	await expect(summaryDialog).toBeVisible();
	await expect(page.getByText('Template Import Summary')).toBeVisible();

	// Vacation Savings already exists, so it should report skipped
	await expect(summaryDialog.getByText(/skipped/i)).toBeVisible();

	// Close dialog
	await summaryDialog.getByRole('button', { name: 'Done' }).click();
	await expect(summaryDialog).not.toBeVisible();
});
