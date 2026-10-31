import { test, expect, type Page } from '@playwright/test';

// On a phone the Transactions list is a stack of cards rather than a seven-column table that
// scrolls sideways.

const noHorizontalScroll = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

test('transactions are cards that fit the screen, with every action in reach', async ({ page }) => {
	await onboard(page, '626301');

	await page.goto('/accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Checking');
	await dialog.getByLabel('Opening balance').fill('10000');
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();

	for (const [amount, notes] of [
		['120', 'Dinner with a rather long description that must not push the amount off screen'],
		['450', 'Fuel']
	]) {
		await page.goto('/transactions/new');
		await page.getByLabel('Account').click();
		await page.getByRole('option', { name: 'Checking', exact: true }).click();
		await page.getByLabel('Amount').fill(amount);
		await page.getByLabel('Notes').fill(notes);
		await page.getByRole('button', { name: 'Save transaction' }).click();
		await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	}

	// No table on a phone, and nothing wider than the screen.
	await expect(page.getByRole('table')).toHaveCount(0);
	expect(await noHorizontalScroll(page)).toBe(true);

	const card = page.getByRole('listitem').filter({ hasText: 'Fuel' });
	await expect(card).toContainText('₹450.00');
	await expect(card).toContainText('Checking');

	// The amount and the actions are on screen, and big enough for a thumb.
	for (const name of ['Edit transaction', 'Delete transaction', 'Attachments']) {
		const box = await card.getByRole('button', { name }).boundingBox();
		expect(box, name).not.toBeNull();
		expect(box!.width).toBeGreaterThanOrEqual(32);
		expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
	}

	// Editing from a card opens the same dialog as the table does.
	await card.getByRole('button', { name: 'Edit transaction' }).click();
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');

	// Selecting from a card brings up the bulk bar.
	await card.getByRole('checkbox', { name: /Select transaction Fuel/ }).check();
	await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText('1 selected');
	expect(await noHorizontalScroll(page)).toBe(true);
});
