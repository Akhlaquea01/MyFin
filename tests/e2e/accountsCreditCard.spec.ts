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

// spec 018, User Story 4 (FR-015-FR-020): "Pay bill" produces one linked transfer pair instead of
// two manual entries, pre-locks the card as destination, rewords the flow, and updates
// utilization immediately. Mirrors quickstart.md Scenario 4.
test('pay a credit card bill in one step', async ({ page }) => {
	await onboard(page, '883322');

	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const cardDialog = page.getByRole('dialog');
	await cardDialog.getByLabel('Name').fill('HDFC Card');
	await chooseOption(page, 'Type', 'Credit Card');
	await cardDialog.getByLabel('Credit limit (optional)').fill('100000');
	await cardDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(cardDialog).not.toBeVisible();

	await page.getByRole('button', { name: 'Add account' }).click();
	const bankDialog = page.getByRole('dialog');
	await bankDialog.getByLabel('Name').fill('Checking');
	await bankDialog.getByLabel('Opening balance').fill('50000');
	await bankDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(bankDialog).not.toBeVisible();

	await addExpense(page, 'HDFC Card', '40000');
	await goTo(page, 'Accounts', 'Accounts');

	const hdfcCard = page.locator('[data-slot="card"]').filter({ hasText: 'HDFC Card' });
	const checkingCard = page.locator('[data-slot="card"]').filter({ hasText: 'Checking' });
	await expect(hdfcCard.getByText('Used 40,000.00')).toBeVisible();

	// FR-015: "Pay bill" is offered only on credit-card accounts.
	await checkingCard.getByRole('button', { name: 'Checking actions' }).click();
	await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeVisible();
	await expect(page.getByRole('menuitem', { name: 'Pay bill' })).toHaveCount(0);
	await page.keyboard.press('Escape');

	// FR-016/FR-019: destination pre-selected and locked, wording describes paying a bill.
	await hdfcCard.getByRole('button', { name: 'HDFC Card actions' }).click();
	await page.getByRole('menuitem', { name: 'Pay bill' }).click();
	await expect(page.getByRole('heading', { name: 'Pay Credit Card Bill' })).toBeVisible();
	await expect(page.getByLabel('To')).toHaveText('HDFC Card');
	await expect(page.getByLabel('To')).toBeDisabled();

	// FR-020: source account is still the user's own choice.
	await chooseOption(page, 'From', 'Checking');
	await page.getByLabel('Amount').fill('20000');
	await page.getByRole('button', { name: 'Record payment' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	// FR-017: exactly one linked pair — both legs reflected in each account's balance.
	await goTo(page, 'Accounts', 'Accounts');
	await expect(checkingCard.getByText('30,000.00')).toBeVisible(); // 50,000 - 20,000

	// FR-018: card utilization reflects the payment immediately, no extra navigation beyond
	// the one already-required trip back to Accounts.
	await expect(hdfcCard.getByText('Used 20,000.00')).toBeVisible();
	await expect(hdfcCard.getByText('Available 80,000.00')).toBeVisible();
	await expect(hdfcCard.getByText('20% utilized')).toBeVisible();

	// spec Edge Cases: overpayment is not blocked; utilization clamps to 0 used / 100% available.
	await hdfcCard.getByRole('button', { name: 'HDFC Card actions' }).click();
	await page.getByRole('menuitem', { name: 'Pay bill' }).click();
	await expect(page.getByRole('heading', { name: 'Pay Credit Card Bill' })).toBeVisible();
	await chooseOption(page, 'From', 'Checking');
	await page.getByLabel('Amount').fill('30000');
	await page.getByRole('button', { name: 'Record payment' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await goTo(page, 'Accounts', 'Accounts');
	await expect(hdfcCard.getByText('Used 0.00')).toBeVisible();
	await expect(hdfcCard.getByText('Available 100,000.00')).toBeVisible();
	await expect(hdfcCard.getByText('0% utilized')).toBeVisible();
	await expect(hdfcCard.getByText('Over limit')).toHaveCount(0);
	await expect(hdfcCard.getByText('High utilization')).toHaveCount(0);
});

// spec 018, User Story 4, spec Edge Cases: "Pay bill" on a card with no other account to pay
// from degrades to a prompt instead of a broken/empty picker.
test('pay bill degrades gracefully with no eligible source account', async ({ page }) => {
	await onboard(page, '990011');

	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const cardDialog = page.getByRole('dialog');
	await cardDialog.getByLabel('Name').fill('Only Card');
	await chooseOption(page, 'Type', 'Credit Card');
	await cardDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(cardDialog).not.toBeVisible();

	const onlyCard = page.locator('[data-slot="card"]').filter({ hasText: 'Only Card' });
	await onlyCard.getByRole('button', { name: 'Only Card actions' }).click();
	await page.getByRole('menuitem', { name: 'Pay bill' }).click();
	await expect(page.getByRole('heading', { name: 'Pay Credit Card Bill' })).toBeVisible();

	await expect(page.getByText("You don't have another account to pay from yet.")).toBeVisible();
	await expect(page.getByRole('button', { name: 'Record payment' })).toBeDisabled();

	await page.getByRole('link', { name: 'Add a bank or cash account' }).click();
	await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
});
