import { test, expect, type Page } from '@playwright/test';

// Buying and selling units moves a holding's recorded value with them.

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await page.getByRole('link', { name: 'Investments', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Investments' })).toBeVisible();
}

async function addHolding(page: Page, name: string, units: string, price: string) {
	await page.getByRole('button', { name: 'Add holding' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Units').fill(units);
	await dialog.getByLabel('Avg. price / unit').fill(price);
	await dialog.getByRole('button', { name: 'Add holding' }).click();
	await expect(dialog).not.toBeVisible();
}

const cardFor = (page: Page, name: string) =>
	page.locator('[data-slot="card"]').filter({ hasText: name });

test('a recorded value shrinks as units are sold, grows as they are bought, and ends at nothing', async ({
	page
}) => {
	await onboard(page, '121211');
	await addHolding(page, 'BEL', '10', '100');
	const card = cardFor(page, 'BEL');
	const summary = page.locator('[data-slot="card"]').filter({ hasText: 'Portfolio Summary' });

	// Worth 1,500 for the 10 units.
	await card.getByRole('button', { name: 'Update value' }).click();
	await page.getByRole('dialog').getByLabel('Current value').fill('1500');
	await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
	await expect(card).toContainText('1,500.00');

	// Sell 4 of 10: 6/10 of 1,500.
	await card.getByRole('button', { name: 'Sell units' }).click();
	await page.getByRole('dialog').getByLabel('Units sold').fill('4');
	await page.getByRole('dialog').getByRole('button', { name: 'Record sale' }).click();
	await expect(card).toContainText('900.00');
	await expect(card).toContainText('6 units');

	// Buy 2 more at 120: the 240.00 spent is added, not reported as a loss.
	await card.getByRole('button', { name: 'Buy more units' }).click();
	await page.getByRole('dialog').getByLabel('Units purchased').fill('2');
	await page.getByRole('dialog').getByLabel('Price / unit').fill('120');
	await page.getByRole('dialog').getByRole('button', { name: 'Record purchase' }).click();
	await expect(card).toContainText('1,140.00');
	await expect(card).toContainText('8 units');

	// Sell the rest: nothing is left, and nothing keeps counting toward the portfolio.
	await card.getByRole('button', { name: 'Sell units' }).click();
	await page.getByRole('dialog').getByLabel('Units sold').fill('8');
	await page.getByRole('dialog').getByRole('button', { name: 'Record sale' }).click();
	await expect(card).toContainText('0.00');
	await expect(card).toContainText('0 units');
	await expect(summary).not.toContainText('1,140.00');
	await expect(summary).not.toContainText('900.00');
});
