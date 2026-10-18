import { test, expect } from '@playwright/test';

// A yearly rule is a calendar date - a month and a day of that month - not a count of days into the
// year, so it falls on the same date every year, leap years included.

test('a yearly rule is set, shown and edited as a month and a day', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('595959');
	await page.getByLabel('Confirm PIN').fill('595959');
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
	await categoryDialog.getByLabel('Name').fill('Insurance');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Recurring' }).click();
	await expect(page.getByRole('heading', { name: 'Recurring Finances' })).toBeVisible();
	await page.getByRole('button', { name: 'Add rule' }).click();
	const ruleDialog = page.getByRole('dialog');
	await ruleDialog.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking' }).click();
	await ruleDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Insurance' }).click();
	await ruleDialog.getByLabel('Amount').fill('1200');

	// The month only appears once the rule is yearly.
	await expect(ruleDialog.getByLabel('Month')).toHaveCount(0);
	await ruleDialog.getByLabel('Frequency').click();
	await page.getByRole('option', { name: 'Yearly' }).click();
	await ruleDialog.getByLabel('Month').click();
	await page.getByRole('option', { name: 'March' }).click();
	await ruleDialog.getByLabel('Day').fill('1');
	await ruleDialog.getByRole('button', { name: 'Add rule' }).click();
	await expect(ruleDialog).not.toBeVisible();
	await expect(page.getByText(/Yearly · 1 Mar/)).toBeVisible();

	// Editing starts from the month and day it was saved with; a day the month does not have is refused.
	await page.getByRole('button', { name: 'Edit Insurance' }).click();
	const editDialog = page.getByRole('dialog');
	await expect(editDialog.getByLabel('Month')).toContainText('March');
	await expect(editDialog.getByLabel('Day')).toHaveValue('1');
	await editDialog.getByLabel('Month').click();
	await page.getByRole('option', { name: 'February' }).click();
	await editDialog.getByLabel('Day').fill('30');
	await editDialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(editDialog.getByRole('alert')).toBeVisible();

	// 29 February is allowed: it falls on the 28th in a year without one.
	await editDialog.getByLabel('Day').fill('29');
	await editDialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(editDialog).not.toBeVisible();
	await expect(page.getByText(/Yearly · 29 Feb/)).toBeVisible();
});
