import { test, expect } from '@playwright/test';

// User Story 7 (P7): net worth equals assets (cash + investments) minus liabilities.

/** shadcn/Radix Select isn't a native <select> — open it and click the option instead. */
async function chooseOption(
	page: import('@playwright/test').Page,
	comboboxLabel: string,
	optionName: string
) {
	await page.getByLabel(comboboxLabel).click();
	await page.getByRole('option', { name: optionName, exact: true }).click();
}

test('adding a holding and a liability updates net worth correctly', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('343484');
	await page.getByLabel('Confirm PIN').fill('343484');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('1000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	// spec 016 replaced the free-text Type + Cost basis fields with a fixed Type dropdown plus
	// Units/Avg. price per unit (costBasis is derived: 1 unit @ ₹500 = ₹500 cost basis).
	await page.getByRole('link', { name: 'Investments' }).click();
	await page.getByRole('button', { name: 'Add holding' }).click();
	const holdingDialog = page.getByRole('dialog');
	await holdingDialog.getByLabel('Name').fill('Index Fund');
	await chooseOption(page, 'Type', 'Mutual Fund');
	await holdingDialog.getByLabel('Units').fill('1');
	await holdingDialog.getByLabel('Avg. price / unit').fill('500');
	await holdingDialog.getByRole('button', { name: 'Add holding' }).click();
	await expect(holdingDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Liabilities' }).click();
	await page.getByRole('button', { name: 'Add liability' }).click();
	const liabilityDialog = page.getByRole('dialog');
	await liabilityDialog.getByLabel('Name').fill('Car Loan');
	await liabilityDialog.getByLabel('Outstanding balance').fill('300');
	await liabilityDialog.getByRole('button', { name: 'Add liability' }).click();
	await expect(liabilityDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Net Worth' }).click();
	await expect(page.getByRole('heading', { name: 'Net Worth' })).toBeVisible();
	// 1000 (cash) + 500 (investment) - 300 (liability) = 1200
	const netWorthCard = page.locator('[data-slot="card"]').filter({ hasText: 'Total Net Worth' });
	await expect(netWorthCard).toContainText('1,200.00');
});
