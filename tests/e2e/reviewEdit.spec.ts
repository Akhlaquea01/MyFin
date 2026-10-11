import { test, expect, type Page } from '@playwright/test';

// Every field of an entry waiting in Review can be corrected before it is confirmed, and saving
// an edit leaves the entry in the queue (confirming is a separate step).

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function goTo(page: Page, linkName: string, headingName: string) {
	await page.getByRole('link', { name: linkName }).click();
	await expect(page.getByRole('heading', { name: headingName })).toBeVisible();
}

test('an entry in Review can be edited in place, stays in the queue, and can then be confirmed', async ({
	page
}) => {
	await onboard(page, '818184');

	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('1000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await goTo(page, 'Quick Add', 'Quick Add');
	await page
		.getByLabel('Paste a payment notification')
		.fill('Rs.250.00 debited from A/c XX1234 to Coffee Shop Ref No 999');
	await page.getByRole('button', { name: 'Parse' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByRole('button', { name: 'Confirm & add to review queue' }).click();

	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
	await expect(page.getByText('Coffee Shop')).toBeVisible();
	await expect(page.getByText('-250.00')).toBeVisible();
	// The old copy promised the entry did not count yet, which was never true.
	await expect(page.getByText(/already counted in your balances/)).toBeVisible();
	await expect(page.getByText(/nothing counts in reports/i)).toHaveCount(0);

	await page.getByRole('button', { name: 'Edit transaction' }).click();
	const editDialog = page.getByRole('dialog');
	await editDialog.getByLabel('Amount').fill('300.00');
	await editDialog.getByLabel('Merchant').fill('Cafe Nero');
	await editDialog.getByLabel('Date').fill('2026-10-03');
	await editDialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(editDialog).not.toBeVisible();

	// Still waiting in Review, now showing the corrected values.
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
	await expect(page.getByText('Cafe Nero')).toBeVisible();
	await expect(page.getByText('-300.00')).toBeVisible();
	await expect(page.getByText('2026-10-03')).toBeVisible();
	await expect(page.getByText('1 waiting')).toBeVisible();

	await page.getByRole('button', { name: 'Confirm transaction' }).click();
	await expect(page.getByText('Nothing to review.')).toBeVisible();

	await goTo(page, 'Transactions', 'Transactions');
	await expect(page.getByText('Cafe Nero')).toBeVisible();
});
