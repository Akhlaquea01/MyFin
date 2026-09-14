import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// spec 017, User Story 5 (P5): tag credit cards with a last-4 identifier, auto-match imported/
// pasted transactions to the right card, disambiguate on multiple matches, fall back to the
// manual picker without blocking on no match. Mirrors quickstart.md Scenario 5.

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function goTo(page: Page, linkName: string, headingName: string) {
	// exact:true — the Bulk Text Import result panel's "Go to review queue" link otherwise
	// substring-matches a bare 'Review' nav-link lookup.
	await page.getByRole('link', { name: linkName, exact: true }).click();
	await expect(page.getByRole('heading', { name: headingName })).toBeVisible();
}

async function chooseOption(page: Page, comboboxLabel: string, optionName: string) {
	await page.getByLabel(comboboxLabel).click();
	await page.getByRole('option', { name: optionName, exact: true }).click();
}

async function addTaggedCard(page: Page, name: string, last4: string) {
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await chooseOption(page, 'Type', 'Credit Card');
	await dialog.getByLabel('Last 4 digits (optional)').fill(last4);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

test.describe('card identifier matching', () => {
	test('bulk text import: single match pre-selects, multi-match disambiguates, no match falls back', async ({
		page
	}) => {
		await onboard(page, '384719');

		await goTo(page, 'Accounts', 'Accounts');
		await addTaggedCard(page, 'HDFC Card', '4321');
		await addTaggedCard(page, 'ICICI Card', '8765');
		await page.getByRole('button', { name: 'Add account' }).click();
		const bankDialog = page.getByRole('dialog');
		await bankDialog.getByLabel('Name').fill('Checking');
		await bankDialog.getByLabel('Opening balance').fill('1000');
		await bankDialog.getByRole('button', { name: 'Add account' }).click();
		await expect(bankDialog).not.toBeVisible();

		const tmpDir = mkdtempSync(join(tmpdir(), 'myfin-e2e-'));

		// --- Single match: pre-selected, overridable, not blocking ---
		await goTo(page, 'Review', 'Review Queue');
		await page.getByRole('link', { name: 'Bulk import' }).click();
		await expect(page.getByRole('heading', { name: 'Bulk Text Import' })).toBeVisible();

		const singleMatchPath = join(tmpDir, 'single-match.txt');
		writeFileSync(singleMatchPath, 'Rs.500 debited on card ending 4321 at Amazon');
		await page.locator('input[type="file"]').setInputFiles(singleMatchPath);

		await expect(page.getByText(/Matched by card ending "4321"/)).toBeVisible();
		await expect(page.getByLabel(/Account \(detected/)).toHaveText('HDFC Card');
		await page.getByRole('button', { name: /Import \d+ line/ }).click();
		await expect(page.getByText('Created 1 unreviewed transaction')).toBeVisible();

		// --- Multiple matches: file-level disambiguation required; per-line routing still splits
		//     correctly between both cards regardless of which one is picked as the default ---
		await goTo(page, 'Review', 'Review Queue');
		await page.getByRole('link', { name: 'Bulk import' }).click();
		const mixedPath = join(tmpDir, 'mixed-match.txt');
		writeFileSync(
			mixedPath,
			[
				'Rs.300 debited on card ending 4321 at Store A',
				'Rs.200 debited on card ending 8765 at Store B'
			].join('\n')
		);
		await page.locator('input[type="file"]').setInputFiles(mixedPath);

		await expect(page.getByText(/matches more than one tagged card/)).toBeVisible();
		await page.getByRole('button', { name: 'ICICI Card (ending 8765)' }).click();
		await page.getByRole('button', { name: /Import \d+ line/ }).click();
		await expect(page.getByText('Created 2 unreviewed transactions')).toBeVisible();

		await goTo(page, 'Accounts', 'Accounts');
		const hdfcCard = page.locator('[data-slot="card"]').filter({ hasText: 'HDFC Card' });
		const iciciCard = page.locator('[data-slot="card"]').filter({ hasText: 'ICICI Card' });
		// HDFC: 500 (single-match) + 300 (mixed) = 800 used. ICICI: 200 (mixed) used.
		await expect(hdfcCard.getByText('Used 800.00')).toBeVisible();
		await expect(iciciCard.getByText('Used 200.00')).toBeVisible();

		// --- No match: falls back to the existing manual picker, unchanged and not blocked ---
		await goTo(page, 'Review', 'Review Queue');
		await page.getByRole('link', { name: 'Bulk import' }).click();
		const noMatchPath = join(tmpDir, 'no-match.txt');
		writeFileSync(noMatchPath, 'Rs.100 debited at Local Store');
		await page.locator('input[type="file"]').setInputFiles(noMatchPath);

		await expect(page.getByText(/Matched by/)).toHaveCount(0);
		await expect(page.getByText(/matches more than one/)).toHaveCount(0);
		await chooseOption(page, 'Account', 'Checking');
		await page.getByRole('button', { name: /Import \d+ line/ }).click();
		await expect(page.getByText('Created 1 unreviewed transaction')).toBeVisible();
	});

	test('CSV import: description-column matching pre-selects and disambiguates per file, routes mixed rows per line', async ({
		page
	}) => {
		await onboard(page, '561203');

		await goTo(page, 'Accounts', 'Accounts');
		await addTaggedCard(page, 'HDFC Card', '4321');
		await addTaggedCard(page, 'ICICI Card', '8765');

		const tmpDir = mkdtempSync(join(tmpdir(), 'myfin-e2e-'));
		const csvPath = join(tmpDir, 'mixed-cards.csv');
		writeFileSync(
			csvPath,
			'Date,Description,Amount\n' +
				'2026-01-15,Card ending 4321 at Amazon,-40.00\n' +
				'2026-01-16,Card ending 8765 at Flipkart,-30.00\n'
		);

		await goTo(page, 'Import', 'Import Transactions');
		await page.locator('input[type="file"]').setInputFiles(csvPath);
		await page.getByLabel('Date column').click();
		await page.getByRole('option', { name: 'Date', exact: true }).click();
		await page.getByLabel('Amount column').click();
		await page.getByRole('option', { name: 'Amount', exact: true }).click();
		await page.getByLabel('Description column (optional)').click();
		await page.getByRole('option', { name: 'Description', exact: true }).click();

		// Both identifiers appear in the preview — file-level disambiguation required.
		await expect(page.getByText(/matches more than one tagged card/)).toBeVisible();
		await page.getByRole('button', { name: 'HDFC Card (ending 4321)' }).click();

		await page.getByRole('button', { name: /Import \d+ row/ }).click();
		await expect(page.getByText('Created 2 unreviewed transactions')).toBeVisible();

		await goTo(page, 'Accounts', 'Accounts');
		const hdfcCard = page.locator('[data-slot="card"]').filter({ hasText: 'HDFC Card' });
		const iciciCard = page.locator('[data-slot="card"]').filter({ hasText: 'ICICI Card' });
		// Per-row routing splits correctly even though "HDFC Card" was picked as the file-level
		// default — the ICICI row is still routed by its own line's identifier.
		await expect(hdfcCard.getByText('Used 40.00')).toBeVisible();
		await expect(iciciCard.getByText('Used 30.00')).toBeVisible();
	});
});
