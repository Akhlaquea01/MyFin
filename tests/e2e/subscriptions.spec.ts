import { test, expect } from '@playwright/test';

// User Story 1 (P1, spec 019): a repeating-amount/interval merchant is detected from existing
// transaction history alone — no manual recurring setup. See quickstart.md §1.

function isoDaysAgo(days: number): string {
	return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function addExpense(
	page: import('@playwright/test').Page,
	opts: { amount: string; date: string; notes: string }
) {
	await page.goto('/transactions/new');
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking' }).click();
	await page.getByLabel('Amount').fill(opts.amount);
	await page.getByLabel('Date').fill(opts.date);
	await page.getByLabel('Notes').fill(opts.notes);
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page).toHaveURL(/\/transactions$/);
}

test('a repeating merchant charge is detected as a subscription with no manual setup', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('676784');
	await page.getByLabel('Confirm PIN').fill('676784');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('0');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	// Same notes text (no merchant picked) at two roughly-monthly intervals — enough for
	// detectSubscriptions to classify a monthly-cadence subscription.
	await addExpense(page, { amount: '499', date: isoDaysAgo(60), notes: 'Streamflix Monthly' });
	await addExpense(page, { amount: '499', date: isoDaysAgo(30), notes: 'Streamflix Monthly' });

	await page.getByRole('link', { name: 'Subscriptions' }).click();
	await expect(page.getByRole('heading', { name: 'Subscriptions' })).toBeVisible();
	await expect(page.getByText('STREAMFLIX MONTHLY')).toBeVisible();
	await expect(page.getByText('Monthly', { exact: true })).toBeVisible();
	await expect(page.getByText('499.00 / mo')).toBeVisible();

	// Dismiss removes it from the view.
	await page.getByRole('button', { name: 'Dismiss STREAMFLIX MONTHLY' }).click();
	await expect(page.getByText('STREAMFLIX MONTHLY')).not.toBeVisible();
	await expect(page.getByText('No repeating charges detected yet')).toBeVisible();
});

test('a single, non-repeating charge is not flagged as a subscription', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('676784');
	await page.getByLabel('Confirm PIN').fill('676784');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('0');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await addExpense(page, { amount: '2500', date: isoDaysAgo(5), notes: 'One-off Purchase' });

	await page.getByRole('link', { name: 'Subscriptions' }).click();
	await expect(page.getByText('No repeating charges detected yet')).toBeVisible();
});
