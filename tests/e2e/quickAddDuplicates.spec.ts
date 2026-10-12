import { test, expect, type Page } from '@playwright/test';

// Quick Add: rupee-sign amounts are read, and pasting the same message twice is noticed.

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

async function addAccount(page: Page, name: string) {
	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Opening balance').fill('10000');
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

async function pasteAndParse(page: Page, text: string, accountName: string) {
	await goTo(page, 'Quick Add', 'Quick Add');
	await page.getByLabel('Paste a payment notification').fill(text);
	await page.getByRole('button', { name: 'Parse' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: accountName, exact: true }).click();
}

test('a rupee-sign amount with no "Rs" is read into the form', async ({ page }) => {
	await onboard(page, '314160');
	await addAccount(page, 'Checking');
	await pasteAndParse(page, '₹1,250.50 debited from A/c XX1234 to AMAZON', 'Checking');
	await expect(page.getByLabel('Amount')).toHaveValue('1250.50');
	await expect(page.getByLabel('Merchant')).toHaveValue('AMAZON');
	await expect(page.getByText(/Couldn't confidently read that message/)).toHaveCount(0);
});

test('an amount that names no currency is read too', async ({ page }) => {
	await onboard(page, '314161');
	await addAccount(page, 'Checking');
	await pasteAndParse(page, 'Your a/c is debited by 480.00 on 01-03-26 trf to ZOMATO', 'Checking');
	await expect(page.getByLabel('Amount')).toHaveValue('480.00');
});

test('pasting the same message twice warns, and "Add anyway" saves it flagged as a possible duplicate', async ({
	page
}) => {
	await onboard(page, '314162');
	await addAccount(page, 'Checking');
	const message = '₹250.00 debited from A/c XX1234 to SWIGGY Ref 1';

	// First paste: no warning, goes straight to the Review queue.
	await pasteAndParse(page, message, 'Checking');
	await page.getByRole('button', { name: 'Confirm & add to review queue' }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();

	// Second paste of the same thing: the first Confirm only warns.
	await pasteAndParse(page, message, 'Checking');
	await page.getByRole('button', { name: 'Confirm & add to review queue' }).click();
	await expect(page.getByText('This looks like something you already have.')).toBeVisible();
	await expect(page.getByText(/₹250\.00.*SWIGGY.*waiting in Review/)).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Quick Add' })).toBeVisible(); // nothing saved yet

	// Changing the amount makes the warning irrelevant, so it goes away.
	await page.getByLabel('Amount').fill('251');
	await expect(page.getByText('This looks like something you already have.')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Confirm & add to review queue' })).toBeVisible();
	// …and comes straight back if the entry is put back as it was, since it is still true.
	await page.getByLabel('Amount').fill('250');
	await expect(page.getByText('This looks like something you already have.')).toBeVisible();

	// Add anyway: saved, and Review marks it so the two can be compared.
	await page.getByRole('button', { name: 'Add anyway' }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
	await expect(page.getByText('Possible duplicate')).toHaveCount(1);
	await expect(page.locator('[data-slot="card"]').filter({ hasText: 'SWIGGY' })).toHaveCount(2);
});

test('the same amount on a different account is not a duplicate', async ({ page }) => {
	await onboard(page, '314163');
	await addAccount(page, 'Checking');
	await addAccount(page, 'Wallet');
	const message = '₹99.00 debited from A/c XX1234 to METRO Ref 7';

	await pasteAndParse(page, message, 'Checking');
	await page.getByRole('button', { name: 'Confirm & add to review queue' }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();

	await pasteAndParse(page, message, 'Wallet');
	await page.getByRole('button', { name: 'Confirm & add to review queue' }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
	await expect(page.getByText('Possible duplicate')).toHaveCount(0);
});
