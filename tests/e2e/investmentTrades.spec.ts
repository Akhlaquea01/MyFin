import { test, expect, type Page } from '@playwright/test';
import { acceptConfirm } from './helpers';

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

async function addAccount(page: Page, name: string, balance: string) {
	await page.getByRole('link', { name: 'Accounts', exact: true }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Opening balance').fill(balance);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

async function pick(page: Page, label: string, option: string) {
	await page.getByLabel(label, { exact: true }).click();
	await page.getByRole('option', { name: option, exact: true }).click();
}

test('a purchase and a sale can move money through an account, and the latest trade can be undone', async ({
	page
}) => {
	await onboard(page, '338216');
	await addAccount(page, 'Checking', '5000');
	await page.getByRole('link', { name: 'Investments', exact: true }).click();
	await addHolding(page, 'BEL', '10', '100');
	const card = cardFor(page, 'BEL');
	const checking = () => page.locator('[data-slot="card"]').filter({ hasText: 'Checking' });

	// --- Buy 5 @ 120 = 600.00 out of Checking, in one step ---
	await card.getByRole('button', { name: 'Buy more units' }).click();
	const buy = page.getByRole('dialog');
	await buy.getByLabel('Units purchased').fill('5');
	await buy.getByLabel('Price / unit').fill('120');
	await pick(page, 'Paid from (optional)', 'Checking');
	await buy.getByRole('button', { name: 'Record purchase' }).click();
	await expect(page.getByText(/₹600\.00 taken from Checking/)).toBeVisible();
	await expect(card).toContainText('15 units');

	await page.getByRole('link', { name: 'Accounts', exact: true }).click();
	await expect(checking()).toContainText('4,400.00');

	// The entry is in the ledger but belongs to the holding: it cannot be deleted on its own.
	await page.getByRole('link', { name: 'Transactions', exact: true }).click();
	const row = page.getByRole('row', { name: /Bought 5 units of BEL/ });
	await expect(row).toContainText('-₹600.00');
	await row.getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByText(/managed there/)).toBeVisible();
	await expect(row).toBeVisible();

	// --- The holding lists the trade, and its latest can be undone: units and money both return ---
	await page.getByRole('link', { name: 'Investments', exact: true }).click();
	await page.getByRole('button', { name: 'Edit BEL' }).click();
	const edit = page.getByRole('dialog');
	await expect(edit.getByText('Purchases and sales')).toBeVisible();
	await expect(edit.getByText(/Bought 5 units @ ₹120\.00/)).toBeVisible();
	await expect(edit.getByText(/paid from Checking/)).toBeVisible();
	await edit.getByRole('button', { name: 'Undo latest trade' }).click();
	await acceptConfirm(page, '600.00 goes back into Checking');
	await expect(edit).not.toBeVisible();
	await expect(cardFor(page, 'BEL')).toContainText('10 units');
	await page.getByRole('link', { name: 'Accounts', exact: true }).click();
	await expect(checking()).toContainText('5,000.00');

	// --- Sell 4 @ 150 into Checking: the price is needed once an account is chosen ---
	await page.getByRole('link', { name: 'Investments', exact: true }).click();
	await cardFor(page, 'BEL').getByRole('button', { name: 'Sell units' }).click();
	const sell = page.getByRole('dialog');
	await sell.getByLabel('Units sold').fill('4');
	await expect(sell.getByLabel('Sale price / unit')).toHaveCount(0);
	await pick(page, 'Proceeds to (optional)', 'Checking');
	await sell.getByRole('button', { name: 'Record sale' }).click();
	await expect(sell.getByText(/Enter the sale price per unit/)).toBeVisible();
	await sell.getByLabel('Sale price / unit').fill('150');
	await sell.getByRole('button', { name: 'Record sale' }).click();
	await expect(page.getByText(/₹600\.00 added to Checking/)).toBeVisible();
	await expect(cardFor(page, 'BEL')).toContainText('6 units');
	await page.getByRole('link', { name: 'Accounts', exact: true }).click();
	await expect(checking()).toContainText('5,600.00');
});

test('a trade with no account changes only the holding', async ({ page }) => {
	await onboard(page, '121213');
	await addAccount(page, 'Checking', '5000');
	await page.getByRole('link', { name: 'Investments', exact: true }).click();
	await addHolding(page, 'BEL', '10', '100');

	await cardFor(page, 'BEL').getByRole('button', { name: 'Buy more units' }).click();
	const buy = page.getByRole('dialog');
	await buy.getByLabel('Units purchased').fill('5');
	await buy.getByLabel('Price / unit').fill('120');
	await buy.getByRole('button', { name: 'Record purchase' }).click();
	await expect(page.getByText('Purchase recorded', { exact: true })).toBeVisible();
	await expect(cardFor(page, 'BEL')).toContainText('15 units');

	await page.getByRole('link', { name: 'Accounts', exact: true }).click();
	await expect(page.locator('[data-slot="card"]').filter({ hasText: 'Checking' })).toContainText(
		'5,000.00'
	);
});
