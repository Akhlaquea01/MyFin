import { test, expect, type Page } from '@playwright/test';

// User Story 4 (P4): Quick Add paste flow proposes a transaction, and pasting the same
// text again is flagged as a likely duplicate rather than silently created twice.

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

test('Quick Add proposes a transaction from pasted text and it appears in review', async ({
	page
}) => {
	await onboard(page, '818184');

	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Checking');
	await dialog.getByLabel('Opening balance').fill('1000');
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();

	await goTo(page, 'Quick Add', 'Quick Add');
	await page
		.getByLabel('Paste a payment notification')
		.fill('Rs.250.00 debited from A/c XX1234 to Coffee Shop Ref No 999');
	await page.getByRole('button', { name: 'Parse' }).click();

	await expect(page.getByText("Couldn't confidently read")).not.toBeVisible();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();

	// Prefilled from integer paise at full currency precision; the old value came from
	// `(paise / 100).toString()`, which dropped trailing zeros.
	await expect(page.getByLabel('Amount')).toHaveValue('250.00');
	await expect(page.getByLabel('Merchant')).toHaveValue('Coffee Shop');

	await page.getByRole('button', { name: 'Confirm & add to review queue' }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
	await expect(page.getByText('Coffee Shop')).toBeVisible();
});
