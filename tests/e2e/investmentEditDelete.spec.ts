import { test, expect, type Page } from '@playwright/test';
import { acceptConfirm, dismissConfirm } from './helpers';

// A holding can be corrected and removed after it is added, and a mistyped value can be fixed —
// before, a typo meant living with it (no edit, no delete, and re-entering a value the same day
// did not reliably replace the first one).

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await page.getByRole('link', { name: 'Investments', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Investments' })).toBeVisible();
}

async function addHolding(page: Page, name: string, type: string, units: string, price: string) {
	await page.getByRole('button', { name: 'Add holding' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Type').click();
	await page.getByRole('option', { name: type, exact: true }).click();
	await dialog.getByLabel('Units').fill(units);
	await dialog.getByLabel('Avg. price / unit').fill(price);
	await dialog.getByRole('button', { name: 'Add holding' }).click();
	await expect(dialog).not.toBeVisible();
}

const cardFor = (page: Page, name: string) =>
	page.locator('[data-slot="card"]').filter({ hasText: name });

async function setValue(page: Page, name: string, value: string) {
	await cardFor(page, name).getByRole('button', { name: 'Update value' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Current value').fill(value);
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).not.toBeVisible();
}

test('a holding can be edited, and the cost basis follows its units and price', async ({
	page
}) => {
	await onboard(page, '707071');
	await addHolding(page, 'BEL', 'Stock', '10', '100');
	await expect(cardFor(page, 'BEL')).toContainText('10 units @ ₹100.00 avg · cost basis ₹1,000.00');

	await page.getByRole('button', { name: 'Edit BEL' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Bharat Electronics');
	await dialog.getByLabel('Type').click();
	await page.getByRole('option', { name: 'ETF', exact: true }).click();
	await dialog.getByLabel('Units').fill('12');
	await dialog.getByLabel('Avg. price / unit').fill('95');
	// The consequence is visible before saving.
	await expect(dialog.getByText(/Cost basis: ₹1,140\.00/)).toBeVisible();
	await dialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(dialog).not.toBeVisible();

	const card = cardFor(page, 'Bharat Electronics');
	await expect(card).toContainText('12 units @ ₹95.00 avg · cost basis ₹1,140.00');
	await expect(card.getByText('ETF')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Edit BEL' })).toHaveCount(0);

	// Nonsense is refused with the dialog left open.
	await page.getByRole('button', { name: 'Edit Bharat Electronics' }).click();
	await dialog.getByLabel('Name').fill('   ');
	await dialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('Name is required.')).toBeVisible();
	await expect(dialog).toBeVisible();
});

test('re-entering today’s value corrects it, and a wrong recorded value can be deleted', async ({
	page
}) => {
	await onboard(page, '707072');
	await addHolding(page, 'Gold', 'Other', '1', '500');

	// "Update value" starts from what the holding is worth now, not from zero.
	await cardFor(page, 'Gold').getByRole('button', { name: 'Update value' }).click();
	await expect(page.getByRole('dialog').getByLabel('Current value')).toHaveValue('500.00');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog')).not.toBeVisible();

	await setValue(page, 'Gold', '1000000'); // a typo
	await expect(cardFor(page, 'Gold')).toContainText('1,000,000.00');
	await setValue(page, 'Gold', '1500'); // corrected the same day
	await expect(cardFor(page, 'Gold')).toContainText('1,500.00');
	await expect(cardFor(page, 'Gold')).not.toContainText('1,000,000.00');

	// Only one value is recorded for the day, and it can be removed outright.
	await page.getByRole('button', { name: 'Edit Gold' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('button', { name: /Delete value from/ })).toHaveCount(1);
	await expect(dialog.getByText('(current)')).toBeVisible();
	await dialog.getByRole('button', { name: /Delete value from/ }).click();
	await acceptConfirm(page, '1,500.00');
	await expect(dialog.getByText(/None yet/)).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel' }).click();

	// With no recorded value the holding is back to its cost basis, marked as an estimate.
	await expect(cardFor(page, 'Gold')).toContainText('estimated (cost basis)');
	await expect(cardFor(page, 'Gold')).toContainText('500.00');
});

test('a holding can be deleted, and Undo brings it back', async ({ page }) => {
	await onboard(page, '707073');
	await addHolding(page, 'BEL', 'Stock', '10', '100');
	await addHolding(page, 'Gold', 'Other', '1', '500');
	const summary = page.locator('[data-slot="card"]').filter({ hasText: 'Portfolio Summary' });
	await expect(summary).toContainText('1,500.00');

	// Declining the prompt keeps it.
	await page.getByRole('button', { name: 'Delete BEL' }).click();
	await dismissConfirm(page);
	await expect(cardFor(page, 'BEL')).toBeVisible();

	await page.getByRole('button', { name: 'Delete BEL' }).click();
	await acceptConfirm(page, 'Delete BEL?');
	await expect(page.getByText('BEL deleted')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Edit BEL' })).toHaveCount(0);
	// It stops counting toward the portfolio.
	await expect(summary).toContainText('500.00');
	await expect(summary).not.toContainText('1,500.00');

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByRole('button', { name: 'Edit BEL' })).toBeVisible();
	await expect(summary).toContainText('1,500.00');
});
