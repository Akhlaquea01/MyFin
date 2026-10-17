import { test, expect } from '@playwright/test';
import { acceptConfirm, dismissConfirm } from './helpers';

// User Story 6 (P6): a recurring rule produces an expected event ahead of time, and a
// matching transaction links to it (missed-flagging is covered at the unit level since it
// depends on real elapsed time relative to the rule's due date).

test('a recurring rule produces an upcoming expected event', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('676784');
	await page.getByLabel('Confirm PIN').fill('676784');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('0');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Categories' }).click();
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Rent');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Recurring' }).click();
	await expect(page.getByRole('heading', { name: 'Recurring Finances' })).toBeVisible();
	await page.getByRole('button', { name: 'Add rule' }).click();
	const ruleDialog = page.getByRole('dialog');
	await ruleDialog.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking' }).click();
	await ruleDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Rent' }).click();
	await ruleDialog.getByLabel('Amount').fill('200');
	await ruleDialog.getByRole('button', { name: 'Add rule' }).click();
	await expect(ruleDialog).not.toBeVisible();
	await expect(page.getByText('Rent', { exact: true })).toBeVisible();
	await expect(page.getByText('Active')).toBeVisible();

	await page.getByRole('link', { name: 'Upcoming' }).click();
	await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible();
	// A monthly rule can produce more than one occurrence within the 60-day lookahead.
	await expect(page.getByText('Rent', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('pending').first()).toBeVisible();
});

test('a rule can be edited, and deleted after a confirmation', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('676785');
	await page.getByLabel('Confirm PIN').fill('676785');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('0');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Categories' }).click();
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Rent');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Recurring' }).click();
	await expect(page.getByRole('heading', { name: 'Recurring Finances' })).toBeVisible();
	await page.getByRole('button', { name: 'Add rule' }).click();
	const ruleDialog = page.getByRole('dialog');
	await ruleDialog.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking' }).click();
	await ruleDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Rent' }).click();
	await ruleDialog.getByLabel('Amount').fill('200');
	await ruleDialog.getByRole('button', { name: 'Add rule' }).click();
	await expect(ruleDialog).not.toBeVisible();
	await expect(page.getByText('-₹200.00')).toBeVisible();

	// Edit: the dialog opens with what the rule has now, and saving changes the card.
	await page.getByRole('button', { name: 'Edit Rent' }).click();
	const editDialog = page.getByRole('dialog');
	await expect(editDialog.getByRole('heading', { name: 'Edit recurring rule' })).toBeVisible();
	await expect(editDialog.getByLabel('Amount')).toHaveValue('200.00');
	await editDialog.getByLabel('Amount').fill('250');
	await editDialog.getByLabel('Day').fill('15');
	await editDialog.getByLabel('Label (optional)').fill('Flat rent');
	await editDialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(editDialog).not.toBeVisible();
	await expect(page.getByText('-₹250.00')).toBeVisible();
	await expect(page.getByText('Flat rent', { exact: true })).toBeVisible();
	await expect(page.getByText(/day 15/)).toBeVisible();
	await expect(page.getByText('-₹200.00')).toHaveCount(0);

	// Adding a rule afterwards still starts empty.
	await page.getByRole('button', { name: 'Add rule' }).click();
	await expect(
		page.getByRole('dialog').getByRole('heading', { name: 'New recurring rule' })
	).toBeVisible();
	await expect(page.getByRole('dialog').getByLabel('Label (optional)')).toHaveValue('');
	await page.keyboard.press('Escape');

	// Delete asks first; cancelling keeps it.
	await page.getByRole('button', { name: 'Delete Flat rent' }).click();
	await dismissConfirm(page, /Delete the Flat rent rule?/);
	await expect(page.getByText('Flat rent', { exact: true })).toBeVisible();

	await page.getByRole('button', { name: 'Delete Flat rent' }).click();
	await acceptConfirm(page);
	await expect(page.getByText('Flat rent', { exact: true })).toHaveCount(0);
	await expect(page.getByText('No recurring rules yet.')).toBeVisible();
});
