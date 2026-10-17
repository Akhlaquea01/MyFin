import { test, expect, type Page } from '@playwright/test';
import { acceptConfirm } from './helpers';

// Marking an expense as debt, savings, investment or a bill while recording it: the entry is tagged
// AND the debt, goal or bill it was for is updated in the same step.

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
async function chooseOption(page: Page, comboboxLabel: string, optionName: string | RegExp) {
	await page.getByLabel(comboboxLabel).click();
	await page
		.getByRole(
			'option',
			typeof optionName === 'string' ? { name: optionName, exact: true } : { name: optionName }
		)
		.click();
}

function card(page: Page, name: string) {
	return page.locator('[data-slot="card"]').filter({ hasText: name });
}

async function addChecking(page: Page, openingBalance: string) {
	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Checking');
	await dialog.getByLabel('Opening balance').fill(openingBalance);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

test('a new expense marked as a debt payment lowers what is owed, and the link holds until it is undone', async ({
	page
}) => {
	await onboard(page, '271828');
	await addChecking(page, '50000');

	await goTo(page, 'Liabilities', 'Liabilities');
	await page.getByRole('button', { name: 'Add liability' }).click();
	const addDialog = page.getByRole('dialog');
	await addDialog.getByLabel('Name').fill('Home Loan');
	await addDialog.getByLabel('Outstanding balance').fill('100000');
	await addDialog.getByRole('button', { name: 'Add liability' }).click();
	await expect(addDialog).not.toBeVisible();
	const loan = card(page, 'Home Loan');
	await expect(loan.getByText('100,000.00').first()).toBeVisible();

	await goTo(page, 'Transactions', 'Transactions');
	await page.getByRole('link', { name: 'New transaction' }).click();
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await chooseOption(page, 'Account', 'Checking');
	await page.getByLabel('Amount').fill('10000');
	await page.getByLabel('Notes').fill('March EMI');

	// A debt needs to say which one.
	await chooseOption(page, 'Purpose', 'Debt payment');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByText('Choose which debt this went to.')).toBeVisible();

	await chooseOption(page, 'Linked item', /Home Loan/);
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	// Tagged in the list …
	const row = page.getByRole('row').filter({ hasText: 'March EMI' });
	await expect(row.getByText('Debt', { exact: true })).toBeVisible();

	// … and the money and the debt both moved.
	await goTo(page, 'Liabilities', 'Liabilities');
	await expect(loan.getByText('90,000.00').first()).toBeVisible();
	await goTo(page, 'Accounts', 'Accounts');
	await expect(card(page, 'Checking').getByText('40,000.00')).toBeVisible();

	// The entry is half of that payment now, so it is managed from Liabilities like any other.
	await goTo(page, 'Transactions', 'Transactions');
	await row.getByRole('button', { name: 'Edit transaction' }).click();
	await expect(
		page.getByRole('dialog').getByRole('link', { name: 'Go to Liabilities' })
	).toBeVisible();
	await page.keyboard.press('Escape');

	await goTo(page, 'Liabilities', 'Liabilities');
	await loan.getByRole('button', { name: 'Undo' }).click();
	await acceptConfirm(page, 'Undo this payment?');
	await expect(loan.getByText('100,000.00').first()).toBeVisible();
});

test('savings marked in Quick Add waits in Review, and confirming it adds the amount to the goal', async ({
	page
}) => {
	await onboard(page, '314159');
	await addChecking(page, '5000');

	await goTo(page, 'Savings Goals', 'Savings Goals');
	await page.getByRole('button', { name: 'Add goal' }).click();
	const goalDialog = page.getByRole('dialog');
	await goalDialog.getByLabel('Name').fill('Holiday');
	await goalDialog.getByLabel('Target amount').fill('10000');
	await goalDialog.getByRole('button', { name: 'Add goal' }).click();
	await expect(goalDialog).not.toBeVisible();
	await expect(card(page, 'Holiday').getByText('(0%)')).toBeVisible();

	await goTo(page, 'Quick Add', 'Quick Add');
	await page
		.getByLabel('Paste a payment notification')
		.fill('Rs.1500.00 debited from A/c XX1234 to Monthly Saver Ref No 998');
	await page.getByRole('button', { name: 'Parse' }).click();
	await chooseOption(page, 'Account', 'Checking');
	await chooseOption(page, 'Purpose', 'Savings');
	await chooseOption(page, 'Linked item', 'Holiday');
	await page.getByRole('button', { name: 'Add to review queue' }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();

	// Tagged, but nothing has moved until it is confirmed.
	await goTo(page, 'Savings Goals', 'Savings Goals');
	await expect(card(page, 'Holiday').getByText('(0%)')).toBeVisible();

	await goTo(page, 'Review', 'Review Queue');
	await page.getByRole('button', { name: 'Confirm transaction' }).click();
	await expect(page.getByText(/Added .*1,500\.00 to Holiday/)).toBeVisible();

	await goTo(page, 'Savings Goals', 'Savings Goals');
	await expect(card(page, 'Holiday').getByText('(15%)')).toBeVisible();
});
