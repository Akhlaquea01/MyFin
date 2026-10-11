import { test, expect, type Page } from '@playwright/test';

// Net worth history used to be as long as the number of times the user remembered to click "Record
// snapshot". It now builds itself, one point per day.

async function addAccount(page: Page, name: string, balance: string) {
	await page.getByRole('link', { name: 'Accounts', exact: true }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Opening balance').fill(balance);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

test('opening Net Worth records today’s point, and "Record snapshot" refreshes it rather than adding another', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('808081');
	await page.getByLabel('Confirm PIN').fill('808081');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	// A brand-new, empty ledger gets no meaningless zero as its first point.
	await page.getByRole('link', { name: 'Net Worth', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Net Worth' })).toBeVisible();
	await expect(page.getByText('No snapshots recorded yet.')).toBeVisible();

	await addAccount(page, 'Checking', '1000');

	// Nobody clicked anything: just looking records the day's point.
	await page.getByRole('link', { name: 'Net Worth', exact: true }).click();
	const history = page.locator('[data-slot="card"]').filter({ hasText: 'History' });
	await expect(history.getByRole('listitem')).toHaveCount(1);
	await expect(history.getByRole('listitem')).toContainText('1,000.00');

	// More money arrives; looking again does not rewrite the point that was already taken…
	await addAccount(page, 'Savings', '500');
	await page.getByRole('link', { name: 'Net Worth', exact: true }).click();
	await expect(history.getByRole('listitem')).toHaveCount(1);
	await expect(history.getByRole('listitem')).toContainText('1,000.00');

	// …but asking for a snapshot refreshes today's point, still as a single entry.
	await page.getByRole('button', { name: 'Record snapshot' }).click();
	await expect(history.getByRole('listitem')).toContainText('1,500.00');
	await expect(history.getByRole('listitem')).toHaveCount(1);
});
