import { test, expect, type Page } from '@playwright/test';

// Holdings, liabilities and budgets are deleted with an Undo toast. Once the toast is gone, Trash is
// the way back — it used to list none of them.

async function goTo(page: Page, linkName: string, headingName: string) {
	await page.getByRole('link', { name: linkName, exact: true }).click();
	await expect(page.getByRole('heading', { name: headingName })).toBeVisible();
}

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

const trashSection = (page: Page, title: string) =>
	page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });

test('a deleted holding, liability and budget can each be restored from Trash', async ({
	page
}) => {
	await onboard(page, '909091');

	// --- set up one of each ---
	await goTo(page, 'Investments', 'Investments');
	await page.getByRole('button', { name: 'Add holding' }).click();
	const holdingDialog = page.getByRole('dialog');
	await holdingDialog.getByLabel('Name').fill('BEL');
	await holdingDialog.getByLabel('Units').fill('10');
	await holdingDialog.getByLabel('Avg. price / unit').fill('100');
	await holdingDialog.getByRole('button', { name: 'Add holding' }).click();
	await expect(holdingDialog).not.toBeVisible();

	await goTo(page, 'Liabilities', 'Liabilities');
	await page.getByRole('button', { name: 'Add liability' }).click();
	const liabilityDialog = page.getByRole('dialog');
	await liabilityDialog.getByLabel('Name').fill('Car Loan');
	await liabilityDialog.getByLabel('Outstanding balance').fill('300');
	await liabilityDialog.getByRole('button', { name: 'Add liability' }).click();
	await expect(liabilityDialog).not.toBeVisible();

	await goTo(page, 'Categories', 'Categories');
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Dining');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await goTo(page, 'Budgets', 'Budgets');
	await page.getByRole('button', { name: 'Add budget' }).click();
	const budgetDialog = page.getByRole('dialog');
	await budgetDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Dining', exact: true }).click();
	await budgetDialog.getByLabel('Amount', { exact: true }).fill('200');
	await budgetDialog.getByRole('button', { name: 'Add budget' }).click();
	await expect(budgetDialog).not.toBeVisible();

	// --- delete them (the Undo toasts are left alone) ---
	page.on('dialog', (d) => void d.accept());
	await page.getByRole('button', { name: 'Dining budget actions' }).click();
	await page.getByRole('menuitem', { name: 'Delete' }).click();
	await expect(page.getByText('Dining budget deleted')).toBeVisible();

	await goTo(page, 'Liabilities', 'Liabilities');
	await page.getByRole('button', { name: 'Remove' }).click();
	await expect(page.getByText('Car Loan deleted')).toBeVisible();

	await goTo(page, 'Investments', 'Investments');
	await page.getByRole('button', { name: 'Delete BEL' }).click();
	await expect(page.getByText('BEL deleted')).toBeVisible();
	await expect(page.getByText('No holdings yet.')).toBeVisible();

	// --- they are in Trash, with enough to recognise them by ---
	await goTo(page, 'Trash', 'Trash');
	await expect(trashSection(page, 'Investments')).toContainText('BEL');
	await expect(trashSection(page, 'Liabilities')).toContainText('Car Loan');
	await expect(trashSection(page, 'Liabilities')).toContainText('300.00 owed');
	await expect(trashSection(page, 'Budgets')).toContainText('Dining');
	await expect(trashSection(page, 'Budgets')).toContainText('200.00');

	// --- and each comes back where it belongs ---
	await trashSection(page, 'Investments').getByRole('button', { name: 'Restore' }).click();
	await expect(trashSection(page, 'Investments')).toContainText('Nothing here.');
	await trashSection(page, 'Liabilities').getByRole('button', { name: 'Restore' }).click();
	await expect(trashSection(page, 'Liabilities')).toContainText('Nothing here.');
	await trashSection(page, 'Budgets').getByRole('button', { name: 'Restore' }).click();
	await expect(trashSection(page, 'Budgets')).toContainText('Nothing here.');

	await goTo(page, 'Investments', 'Investments');
	await expect(page.getByRole('button', { name: 'Edit BEL' })).toBeVisible();
	await goTo(page, 'Liabilities', 'Liabilities');
	await expect(page.getByText('Car Loan').first()).toBeVisible();
	await goTo(page, 'Budgets', 'Budgets');
	await expect(page.getByRole('button', { name: 'Dining budget actions' })).toBeVisible();
});
