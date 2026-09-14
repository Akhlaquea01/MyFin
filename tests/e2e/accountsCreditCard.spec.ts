import { test, expect, type Page } from '@playwright/test';

// spec 017, User Story 1 (P1): credit limit vs. amount used, utilization, over-limit flag.
// Mirrors quickstart.md Scenario 1.

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

/** shadcn/Radix Select isn't a native <select> — open it and click the option instead. */
async function chooseOption(page: Page, comboboxLabel: string, optionName: string) {
	await page.getByLabel(comboboxLabel).click();
	await page.getByRole('option', { name: optionName, exact: true }).click();
}

async function addExpense(page: Page, accountName: string, amount: string) {
	await goTo(page, 'Transactions', 'Transactions');
	await page.getByRole('link', { name: 'New transaction' }).click();
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await chooseOption(page, 'Account', accountName);
	await page.getByLabel('Amount').fill(amount);
	await page.locator('input[type="date"]').fill('2026-01-15');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
}

test('credit card limit, utilization, and over-limit flag', async ({ page }) => {
	await onboard(page, '556677');

	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const addDialog = page.getByRole('dialog');
	await addDialog.getByLabel('Name').fill('HDFC Card');
	await chooseOption(page, 'Type', 'Credit Card');
	await addDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(addDialog).not.toBeVisible();

	const card = page.locator('[data-slot="card"]').filter({ hasText: 'HDFC Card' });

	// FR-004: no limit set yet — used amount shown, no utilization/available figure, a prompt to
	// add a limit instead.
	await expect(card.getByText('Add a credit limit')).toBeVisible();
	await expect(card.getByText('% utilized')).toHaveCount(0);

	// FR-001: set a credit limit + billing cycle day via the edit dialog.
	await card.getByRole('button', { name: 'HDFC Card actions' }).click();
	await page.getByRole('menuitem', { name: 'Edit' }).click();
	const editDialog = page.getByRole('dialog');
	await expect(editDialog.getByRole('heading', { name: 'Edit account' })).toBeVisible();
	await editDialog.getByLabel('Credit limit (optional)').fill('100000');
	await editDialog.getByLabel('Billing cycle day (optional)').fill('5');
	await editDialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(editDialog).not.toBeVisible();

	// FR-002/SC-001: used/available/utilization visible on the card with no further navigation.
	await addExpense(page, 'HDFC Card', '35000');
	await goTo(page, 'Accounts', 'Accounts');
	await expect(card.getByText('Used 35,000.00')).toBeVisible();
	await expect(card.getByText('Available 65,000.00')).toBeVisible();
	await expect(card.getByText('35% utilized')).toBeVisible();

	// FR-003: crossing the 90% threshold flags high utilization.
	await addExpense(page, 'HDFC Card', '60000');
	await goTo(page, 'Accounts', 'Accounts');
	await expect(card.getByText('95% utilized')).toBeVisible();
	await expect(card.getByText('High utilization')).toBeVisible();

	// FR-003 / spec Edge Cases: exceeding the limit entirely flags over-limit, not blocked.
	await addExpense(page, 'HDFC Card', '10000');
	await goTo(page, 'Accounts', 'Accounts');
	await expect(card.getByText('105% utilized')).toBeVisible();
	await expect(card.getByText('Over limit')).toBeVisible();
	await expect(card.getByText('High utilization')).toHaveCount(0);
});
