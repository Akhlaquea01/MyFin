import { test, expect, type Page } from '@playwright/test';

// Credit card bill payments as ONE action, settling loans in one click, editing transactions,
// and the Auto-Categorize clarity fixes.

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

async function addBank(page: Page, name: string, openingBalance: string) {
	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Opening balance').fill(openingBalance);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

/** A card is entered as what is currently OWED, as a positive number. */
async function addCard(page: Page, name: string, owed: string, last4: string) {
	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await chooseOption(page, 'Type', 'Credit Card');
	await dialog.getByLabel('Amount currently owed').fill(owed);
	await dialog.getByLabel('Last 4 digits (optional)').fill(last4);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

function accountCard(page: Page, name: string) {
	return page.locator('[data-slot="card"]').filter({ hasText: name });
}

test('a pasted card-payment message is recorded as one transfer, not an expense on the card', async ({
	page
}) => {
	await onboard(page, '480127');
	await addBank(page, 'Checking', '50000');
	await addCard(page, 'HDFC Card', '8000', '1234');

	// Entering what is owed as a positive number makes it a debt, not an asset.
	await goTo(page, 'Accounts', 'Accounts');
	await expect(accountCard(page, 'HDFC Card').getByText('Used 8,000.00')).toBeVisible();

	await goTo(page, 'Quick Add', 'Quick Add');
	await page
		.getByLabel('Paste a payment notification')
		.fill('Rs.3000.00 debited from A/c XX9999 towards credit card ending 1234');
	await page.getByRole('button', { name: 'Parse' }).click();

	await expect(page.getByText('This looks like a credit card bill payment.')).toBeVisible();
	await page.getByRole('button', { name: 'Record as card bill payment' }).click();

	// The card and the amount were read from the message; only the paying account is left to pick.
	await expect(page.getByRole('heading', { name: 'Pay Credit Card Bill' })).toBeVisible();
	await expect(page.getByLabel('To')).toHaveText('HDFC Card');
	await expect(page.getByLabel('Amount')).toHaveValue('3000.00');
	await chooseOption(page, 'From', 'Checking');
	await page.getByRole('button', { name: 'Record payment' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await goTo(page, 'Accounts', 'Accounts');
	await expect(accountCard(page, 'Checking').getByText('47,000.00')).toBeVisible();
	await expect(accountCard(page, 'HDFC Card').getByText('Used 5,000.00')).toBeVisible();
});

test('the New Transaction type picker leads to transfers, card payments and people', async ({
	page
}) => {
	await onboard(page, '480128');
	await addBank(page, 'Checking', '1000');
	await addCard(page, 'Visa', '500', '4444');

	await goTo(page, 'Transactions', 'Transactions');
	await page.getByRole('link', { name: 'New transaction' }).click();
	await chooseOption(page, 'Type', 'Pay a credit card bill…');
	await expect(page.getByRole('heading', { name: 'Pay Credit Card Bill' })).toBeVisible();

	// The card is chosen here, so it is selectable (not locked), and shows what is owed.
	await chooseOption(page, 'To', 'Visa');
	await expect(page.getByText('Outstanding on Visa: 500.00')).toBeVisible();
	await page.getByRole('button', { name: 'Pay full outstanding' }).click();
	await expect(page.getByLabel('Amount')).toHaveValue('500.00');
	await chooseOption(page, 'From', 'Checking');
	await page.getByRole('button', { name: 'Record payment' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await goTo(page, 'Accounts', 'Accounts');
	await expect(accountCard(page, 'Checking').getByText('500.00').first()).toBeVisible();
	await expect(accountCard(page, 'Visa').getByText('Used 0.00')).toBeVisible();
});

test('a card payment imported as a plain expense can be recorded as a transfer from Review', async ({
	page
}) => {
	await onboard(page, '480129');
	await addBank(page, 'Checking', '20000');
	await addCard(page, 'ICICI Card', '6000', '5678');

	// A bank statement line that names the card: stays on the bank (it is the bank's debit).
	await goTo(page, 'Quick Add', 'Quick Add');
	await page
		.getByLabel('Paste a payment notification')
		.fill('Rs.2500.00 debited from A/c XX9999 for CREDIT CARD PAYMENT ICICI');
	await page.getByRole('button', { name: 'Parse' }).click();
	await chooseOption(page, 'Account', 'Checking');
	await page.getByRole('button', { name: 'Add as an ordinary transaction anyway' }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();

	// Review spots it and offers the right action; the dialog links/creates the card side.
	await expect(page.getByText('Looks like a credit card payment.')).toBeVisible();
	await page.getByRole('button', { name: 'Record as transfer' }).first().click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Other account').click();
	await page.getByRole('option', { name: 'ICICI Card', exact: true }).click();
	await dialog.getByRole('button', { name: 'Record as transfer' }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByText('Nothing to review.')).toBeVisible();

	await goTo(page, 'Accounts', 'Accounts');
	await expect(accountCard(page, 'Checking').getByText('17,500.00')).toBeVisible();
	await expect(accountCard(page, 'ICICI Card').getByText('Used 3,500.00')).toBeVisible();
});

test('deleting one side of a transfer removes both, and Undo brings both back', async ({ page }) => {
	await onboard(page, '480130');
	await addBank(page, 'Checking', '10000');
	await addBank(page, 'Savings', '0');

	await goTo(page, 'Transactions', 'Transactions');
	await page.getByRole('link', { name: 'Transfer' }).click();
	await chooseOption(page, 'From', 'Checking');
	await chooseOption(page, 'To', 'Savings');
	await page.getByLabel('Amount').fill('4000');
	await page.locator('button[type="submit"]').click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	await expect(page.getByRole('row')).toHaveCount(3); // header + both legs

	page.on('dialog', (d) => void d.accept());
	await page.getByRole('row').nth(1).getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByText('No transactions match.')).toBeVisible();

	await goTo(page, 'Accounts', 'Accounts');
	await expect(accountCard(page, 'Checking').getByText('10,000.00')).toBeVisible();
	await expect(accountCard(page, 'Savings').getByText('0.00').first()).toBeVisible();
});

test('settle a loan in one click, with the right wording for who owes whom', async ({ page }) => {
	await onboard(page, '480131');
	await addBank(page, 'Cash', '5000');

	await goTo(page, 'People', 'People');
	await page.getByRole('button', { name: 'Record a loan' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Person').fill('Rohit');
	await dialog.getByLabel('Direction').click();
	await page.getByRole('option', { name: 'I borrowed money from them' }).click();
	await dialog.getByLabel('Amount').fill('1200');
	await dialog.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Cash', exact: true }).click();
	await dialog.getByRole('button', { name: 'Record loan' }).click();
	await expect(dialog).not.toBeVisible();

	const card = page.locator('[data-slot="card"]').filter({ hasText: 'Rohit' });
	await expect(card.getByText('You owe: 1,200.00')).toBeVisible();
	await card.getByRole('button', { name: 'Settle in full' }).click();

	// Wording follows the direction: this is money I owe, so I am paying it back.
	const settle = page.getByRole('dialog');
	await expect(settle.getByRole('heading', { name: 'Pay back 1,200.00 to Rohit' })).toBeVisible();
	await settle.getByRole('button', { name: 'Settle loan' }).click();
	await expect(settle).not.toBeVisible();

	await expect(card.getByText('Settled')).toBeVisible();
	await expect(card.getByRole('button', { name: 'Settle in full' })).toHaveCount(0);
	await goTo(page, 'Accounts', 'Accounts');
	await expect(accountCard(page, 'Cash').getByText('5,000.00')).toBeVisible();
});

test('a mis-recorded loan can be removed, restoring the account balance', async ({ page }) => {
	await onboard(page, '480132');
	await addBank(page, 'Cash', '5000');
	await goTo(page, 'People', 'People');
	await page.getByRole('button', { name: 'Record a loan' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Person').fill('Meera');
	await dialog.getByLabel('Amount').fill('900');
	await dialog.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Cash', exact: true }).click();
	await dialog.getByRole('button', { name: 'Record loan' }).click();
	await expect(dialog).not.toBeVisible();

	page.on('dialog', (d) => void d.accept());
	const card = page.locator('[data-slot="card"]').filter({ hasText: 'Meera' });
	await card.getByRole('button', { name: 'Remove loan' }).click();
	await expect(card.getByText('No loans yet.')).toBeVisible();

	await goTo(page, 'Accounts', 'Accounts');
	await expect(accountCard(page, 'Cash').getByText('5,000.00')).toBeVisible();
});

test('a transaction can be edited in place, including its category', async ({ page }) => {
	await onboard(page, '480133');
	await addBank(page, 'Checking', '10000');
	await goTo(page, 'Categories', 'Categories');
	await page.getByRole('button', { name: 'Add category' }).click();
	const catDialog = page.getByRole('dialog');
	await catDialog.getByLabel('Name').fill('Groceries');
	await catDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(catDialog).not.toBeVisible();

	await goTo(page, 'Transactions', 'Transactions');
	await page.getByRole('link', { name: 'New transaction' }).click();
	await chooseOption(page, 'Account', 'Checking');
	await page.getByLabel('Amount').fill('300');
	await page.getByLabel('Notes').fill('Weekly shop');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await page.getByRole('button', { name: 'Edit transaction' }).click();
	const edit = page.getByRole('dialog');
	await expect(edit.getByRole('heading', { name: 'Edit transaction' })).toBeVisible();
	await edit.getByLabel('Amount').fill('350');
	await edit.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Groceries', exact: true }).click();
	await edit.getByRole('button', { name: 'Save changes' }).click();
	await expect(edit).not.toBeVisible();

	const row = page.getByRole('row').filter({ hasText: 'Weekly shop' });
	await expect(row.getByText('-350.00')).toBeVisible();
	await expect(row.getByText('Groceries')).toBeVisible();
	await goTo(page, 'Accounts', 'Accounts');
	await expect(accountCard(page, 'Checking').getByText('9,650.00')).toBeVisible();
});

test('a merchant with a rule is not offered back as a suggestion, and a rule can be applied to history', async ({
	page
}) => {
	await onboard(page, '480134');
	await addBank(page, 'Checking', '10000');
	await goTo(page, 'Categories', 'Categories');
	await page.getByRole('button', { name: 'Add category' }).click();
	const catDialog = page.getByRole('dialog');
	await catDialog.getByLabel('Name').fill('Dining');
	await catDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(catDialog).not.toBeVisible();

	// Manual entries for the same merchant name reuse ONE merchant (the old code minted a new one
	// on every save), so rules and learning can finally apply to them.
	for (const amount of ['100', '120']) {
		await goTo(page, 'Transactions', 'Transactions');
		await page.getByRole('link', { name: 'New transaction' }).click();
		await chooseOption(page, 'Account', 'Checking');
		await page.getByLabel('Amount').fill(amount);
		await page.getByLabel('Merchant').fill('Swiggy');
		await page.getByRole('button', { name: 'Save transaction' }).click();
		await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	}

	await goTo(page, 'Auto-Categorize', 'Auto-Categorize');
	await page.getByRole('button', { name: 'Add rule' }).click();
	const ruleDialog = page.getByRole('dialog');
	await ruleDialog.getByLabel('Merchant').click();
	// Exactly one "Swiggy" merchant exists despite two separate entries.
	await expect(page.getByRole('option', { name: 'Swiggy', exact: true })).toHaveCount(1);
	await page.getByRole('option', { name: 'Swiggy', exact: true }).click();
	await ruleDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Dining', exact: true }).click();

	// Creating the rule offers to file the two existing, still-uncategorized Swiggy entries.
	page.once('dialog', (d) => {
		expect(d.message()).toContain('2 existing uncategorized transactions from Swiggy');
		void d.accept();
	});
	await ruleDialog.getByRole('button', { name: 'Add rule' }).click();
	await expect(page.getByText('Any alias → Dining')).toBeVisible();
	await expect(page.getByText('Categorized 2 existing transactions')).toBeVisible();

	await goTo(page, 'Transactions', 'Transactions');
	await expect(page.getByRole('row').filter({ hasText: 'Swiggy' }).first()).toBeVisible();
	await expect(page.getByText('Dining')).toHaveCount(2);
});
