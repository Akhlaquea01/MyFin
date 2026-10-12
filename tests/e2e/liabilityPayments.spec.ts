import { test, expect, type Page } from '@playwright/test';
import { acceptConfirm } from './helpers';

// Loans and cards tracked as liabilities: edit their details, and pay them from an account so the
// money and the amount owed move together.

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

function card(page: Page, name: string) {
	return page.locator('[data-slot="card"]').filter({ hasText: name });
}

test('pay a loan EMI from an account: the money and the amount owed move together, and it can be undone', async ({
	page
}) => {
	await onboard(page, '161803');

	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('50000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await goTo(page, 'Liabilities', 'Liabilities');
	await page.getByRole('button', { name: 'Add liability' }).click();
	const addDialog = page.getByRole('dialog');
	await addDialog.getByLabel('Name').fill('Home Loan');
	await addDialog.getByLabel('Outstanding balance').fill('100000');
	await addDialog.getByRole('button', { name: 'Add liability' }).click();
	await expect(addDialog).not.toBeVisible();

	const loan = card(page, 'Home Loan');
	await expect(loan.getByText('100,000.00')).toBeVisible();

	// The details can finally be edited.
	await loan.getByRole('button', { name: 'Edit details' }).click();
	const editDialog = page.getByRole('dialog');
	await editDialog.getByLabel('EMI amount (optional)').fill('10000');
	await editDialog.getByLabel('EMI due day of month (optional)').fill('5');
	await editDialog.getByLabel('Interest rate % per year (optional)').fill('8.5');
	await editDialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(editDialog).not.toBeVisible();
	await expect(loan.getByText('EMI ₹10,000.00 · due on day 5')).toBeVisible();

	// Record the EMI: the amount starts from the EMI.
	await loan.getByRole('button', { name: 'Record payment' }).click();
	const payDialog = page.getByRole('dialog');
	await expect(payDialog.getByLabel('Amount paid')).toHaveValue('10000.00');
	await chooseOption(page, 'Paid from', 'Checking');
	await payDialog.getByRole('button', { name: 'Record payment' }).click();
	await expect(payDialog).not.toBeVisible();

	await expect(loan.getByText('90,000.00').first()).toBeVisible();
	await expect(loan.getByText(/paid ₹10,000\.00 from Checking/)).toBeVisible();

	await goTo(page, 'Accounts', 'Accounts');
	await expect(card(page, 'Checking').getByText('40,000.00')).toBeVisible();

	// Its ledger entry is half of the payment, so it is not editable or deletable on its own.
	await goTo(page, 'Transactions', 'Transactions');
	const row = page.getByRole('row').filter({ hasText: 'Payment to Home Loan' });
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: 'Edit transaction' }).click();
	const txDialog = page.getByRole('dialog');
	await expect(txDialog.getByRole('link', { name: 'Go to Liabilities' })).toBeVisible();
	await page.keyboard.press('Escape');
	await row.getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByText(/managed there/)).toBeVisible();
	await expect(row).toBeVisible(); // nothing was deleted

	// Undo puts both halves back.
	await goTo(page, 'Liabilities', 'Liabilities');
	await loan.getByRole('button', { name: 'Undo' }).click();
	await acceptConfirm(page, 'Undo this payment?');
	await expect(loan.getByText('100,000.00').first()).toBeVisible();
	await goTo(page, 'Accounts', 'Accounts');
	await expect(card(page, 'Checking').getByText('50,000.00')).toBeVisible();
});

test('a payment larger than the balance is refused, and paying it off shows "Paid off"', async ({
	page
}) => {
	await onboard(page, '161804');
	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('5000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await goTo(page, 'Liabilities', 'Liabilities');
	await page.getByRole('button', { name: 'Add liability' }).click();
	const addDialog = page.getByRole('dialog');
	await addDialog.getByLabel('Name').fill('Phone EMI');
	await addDialog.getByLabel('Outstanding balance').fill('1000');
	await addDialog.getByRole('button', { name: 'Add liability' }).click();
	await expect(addDialog).not.toBeVisible();

	const loan = card(page, 'Phone EMI');
	await loan.getByRole('button', { name: 'Record payment' }).click();
	const payDialog = page.getByRole('dialog');
	await chooseOption(page, 'Paid from', 'Checking');
	await payDialog.getByLabel('Amount paid').fill('1500');
	await payDialog.getByRole('button', { name: 'Record payment' }).click();
	await expect(page.getByText(/more than the ₹1,000\.00 still owed/)).toBeVisible();
	await expect(payDialog).toBeVisible();

	await payDialog.getByRole('button', { name: 'Pay the full balance' }).click();
	await expect(payDialog.getByLabel('Amount paid')).toHaveValue('1000.00');
	await payDialog.getByRole('button', { name: 'Record payment' }).click();
	await expect(payDialog).not.toBeVisible();

	await expect(loan.getByText('Paid off')).toBeVisible();
	await expect(loan.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
});
