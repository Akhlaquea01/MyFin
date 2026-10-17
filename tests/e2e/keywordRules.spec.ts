import { test, expect, type Page } from '@playwright/test';
import { acceptConfirm, openScreen } from './helpers';

// Keyword ("description contains") auto-categorization rules.

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

async function addExpense(page: Page, notes: string, amount: string) {
	await goTo(page, 'Transactions', 'Transactions');
	await page.getByRole('link', { name: 'New transaction' }).click();
	await chooseOption(page, 'Account', 'Checking');
	await page.getByLabel('Amount').fill(amount);
	await page.getByLabel('Notes').fill(notes);
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
}

test('a keyword rule previews its matches, files existing entries, and files new ones automatically', async ({
	page
}) => {
	await onboard(page, '271828');

	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('10000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await goTo(page, 'Categories', 'Categories');
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Food');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	// Three different spellings of the same business, entered before any rule exists. None of them
	// has a merchant, so a merchant rule could never have caught them.
	await addExpense(page, 'UPI-SWIGGY-88123 Bangalore', '250');
	await addExpense(page, 'Swiggy Instamart order', '310');
	await addExpense(page, 'Zomato dinner', '400');

	await openScreen(page, 'Automation', 'Auto-Categorize');
	await expect(page.getByRole('heading', { name: 'Auto-Categorize' })).toBeVisible();
	await page.getByRole('button', { name: 'Add rule' }).click();
	const ruleDialog = page.getByRole('dialog');
	await ruleDialog.getByRole('radio', { name: 'Match description text' }).click();

	// Too short a keyword is refused with a reason.
	await ruleDialog.getByLabel('Description contains').fill('sw');
	await ruleDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Food', exact: true }).click();
	await ruleDialog.getByRole('button', { name: 'Add rule' }).click();
	await expect(ruleDialog.getByText(/at least 3 letters or digits/)).toBeVisible();

	// A real keyword shows what it would catch BEFORE it is saved.
	await ruleDialog.getByLabel('Description contains').fill('swiggy');
	await expect(ruleDialog.getByText(/2.*uncategorized.*transactions contain this/)).toBeVisible();
	await expect(ruleDialog.getByText(/UPI-SWIGGY-88123 Bangalore/)).toBeVisible();

	// Saving offers to file the existing history; accept it.
	await ruleDialog.getByRole('button', { name: 'Add rule' }).click();
	await acceptConfirm(
		page,
		/2 existing uncategorized transactions[\s\S]*description contains "swiggy"/
	);
	await expect(ruleDialog).not.toBeVisible();
	await expect(page.getByText('Description contains "swiggy" → Food')).toBeVisible();
	await expect(page.getByText('Categorized 2 existing transactions')).toBeVisible();

	// The two Swiggy entries are now Food; the Zomato one is untouched.
	await goTo(page, 'Transactions', 'Transactions');
	const swiggyRows = page.getByRole('row').filter({ hasText: /swiggy/i });
	await expect(swiggyRows).toHaveCount(2);
	for (const row of await swiggyRows.all()) await expect(row.getByText('Food')).toBeVisible();
	await expect(
		page.getByRole('row').filter({ hasText: 'Zomato dinner' }).getByText('Uncategorized')
	).toBeVisible();

	// New entries are filed automatically, and the form says so before saving.
	await page.getByRole('link', { name: 'New transaction' }).click();
	await chooseOption(page, 'Account', 'Checking');
	await page.getByLabel('Amount').fill('90');
	await page.getByLabel('Notes').fill('swiggy lunch');
	await expect(page.getByText(/Will be filed under/)).toContainText('Food');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	await expect(
		page.getByRole('row').filter({ hasText: 'swiggy lunch' }).getByText('Food')
	).toBeVisible();
});

test('the same keyword cannot be added twice, however it is written', async ({ page }) => {
	await onboard(page, '271829');
	await goTo(page, 'Categories', 'Categories');
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Food');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await openScreen(page, 'Automation', 'Auto-Categorize');
	await expect(page.getByRole('heading', { name: 'Auto-Categorize' })).toBeVisible();
	for (const keyword of ['Swiggy', ' SWIGGY!']) {
		await page.getByRole('button', { name: 'Add rule' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByRole('radio', { name: 'Match description text' }).click();
		await dialog.getByLabel('Description contains').fill(keyword);
		await dialog.getByLabel('Category').click();
		await page.getByRole('option', { name: 'Food', exact: true }).click();
		await dialog.getByRole('button', { name: 'Add rule' }).click();
		if (keyword === 'Swiggy') {
			await expect(dialog).not.toBeVisible();
		} else {
			await expect(page.getByText('A rule for this keyword already exists')).toBeVisible();
			await page.keyboard.press('Escape');
		}
	}
	await expect(page.getByText('Description contains "Swiggy" → Food')).toHaveCount(1);
});
