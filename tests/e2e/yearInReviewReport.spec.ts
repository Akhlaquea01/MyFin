import { test, expect } from '@playwright/test';

// Spec 011 (Year-in-Review / Monthly PDF Report): a generated summary matches manually-entered
// figures, an in-progress period is flagged, a period with no data still renders cleanly, and
// the report can be downloaded as a PDF (quickstart.md Scenarios 1, 3, 4, 6).

test('generates a report matching entered figures for the current month and downloads a PDF', async ({
	page
}) => {
	const pin = '937142';
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('0');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Categories' }).click();
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Groceries');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	// Income 1000, expense 300 (Groceries) this month -> net 700.
	await page.getByRole('link', { name: 'Transactions' }).click();
	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Type').click();
	await page.getByRole('option', { name: 'Income' }).click();
	await page.getByLabel('Amount').fill('1000');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('300');
	await page.locator('button[role="combobox"]').filter({ hasText: 'Category…' }).click();
	await page.getByRole('option', { name: 'Groceries' }).click();
	await page.locator('input[placeholder="Amount"]').fill('300');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	// Report defaults to the current month, which is the one this data was recorded in.
	await page.getByRole('link', { name: 'Export' }).click();
	await expect(page.getByRole('heading', { name: 'Export Transactions' })).toBeVisible();
	await page.getByRole('button', { name: 'Generate Report' }).click();

	await expect(page.getByText('1,000.00')).toBeVisible(); // income
	await expect(page.getByText('300.00').first()).toBeVisible(); // expense / Groceries total
	await expect(page.getByText('700.00')).toBeVisible(); // net income
	await expect(page.getByText('Groceries', { exact: true })).toBeVisible();
	// Current month is still in progress.
	await expect(page.getByText('Reflects data recorded up to today only')).toBeVisible();

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Download PDF' }).click()
	]);
	expect(download.suggestedFilename()).toMatch(/^myfin-report-.*\.pdf$/);
});

test('generates a valid, non-erroring report for a period with no data', async ({ page }) => {
	const pin = '284916';
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	// A brand-new profile has no transactions and no net worth snapshots at all.
	await page.getByRole('link', { name: 'Export' }).click();
	await expect(page.getByRole('heading', { name: 'Export Transactions' })).toBeVisible();
	await page.getByRole('button', { name: 'Generate Report' }).click();

	await expect(page.getByText('No spending recorded for this period.')).toBeVisible();
	await expect(page.getByText('Not available').first()).toBeVisible();

	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('button', { name: 'Download PDF' }).click()
	]);
	expect(download.suggestedFilename()).toMatch(/^myfin-report-.*\.pdf$/);
});
