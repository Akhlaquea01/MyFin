import { test, expect } from '@playwright/test';

// User Story 5 (P5): set a budget, record matching spend, verify actual-vs-planned.

test('setting a budget and recording spend updates actual-vs-planned', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('909084');
	await page.getByLabel('Confirm PIN').fill('909084');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('5000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Categories' }).click();
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Groceries');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Budgets' }).click();
	await expect(page.getByRole('heading', { name: 'Budgets' })).toBeVisible();
	await page.getByRole('button', { name: 'Add budget' }).click();
	const budgetDialog = page.getByRole('dialog');
	await budgetDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Groceries' }).click();
	await budgetDialog.getByLabel('Amount', { exact: true }).fill('100');
	await budgetDialog.getByRole('button', { name: 'Add budget' }).click();
	await expect(budgetDialog).not.toBeVisible();

	await expect(page.getByText('0.00').first()).toBeVisible();
	await expect(page.getByText('of 100.00')).toBeVisible();

	await page.getByRole('link', { name: 'Transactions' }).click();
	await page.getByRole('link', { name: 'New transaction' }).click();
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('40');
	// Assign the transaction's single split to the Groceries category.
	await page.locator('button[role="combobox"]').filter({ hasText: 'Category…' }).click();
	await page.getByRole('option', { name: 'Groceries' }).click();
	await page.locator('input[placeholder="Amount"]').fill('40');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await page.getByRole('link', { name: 'Budgets' }).click();
	await expect(page.getByRole('heading', { name: 'Budgets' })).toBeVisible();
	await expect(page.getByText('40.00').first()).toBeVisible();
});

// spec 017, User Story 3 (P3): edit/delete an existing budget, without retroactively rewriting
// an already-closed period's historical figures. Mirrors quickstart.md Scenario 3.
test('editing and deleting a budget behaves correctly, including the past-month regression case', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('273958');
	await page.getByLabel('Confirm PIN').fill('273958');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Categories' }).click();
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Dining');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Budgets' }).click();
	await expect(page.getByRole('heading', { name: 'Budgets' })).toBeVisible();
	await page.getByRole('button', { name: 'Add budget' }).click();
	let dialog = page.getByRole('dialog');
	await dialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Dining' }).click();
	await dialog.getByLabel('Amount', { exact: true }).fill('100');
	await dialog.getByRole('button', { name: 'Add budget' }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByText('of 100.00')).toBeVisible();

	// FR-015: a second budget for the same category is blocked, not silently allowed.
	await page.getByRole('button', { name: 'Add budget' }).click();
	dialog = page.getByRole('dialog');
	await dialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Dining' }).click();
	await dialog.getByLabel('Amount', { exact: true }).fill('50');
	await dialog.getByRole('button', { name: 'Add budget' }).click();
	await expect(page.getByText(/already has an active budget/)).toBeVisible();
	await page.keyboard.press('Escape');

	// Navigate to the previous month — creates a fresh BudgetItem there using today's amount.
	await page.getByRole('button', { name: 'Previous month' }).click();
	await expect(page.getByText('of 100.00')).toBeVisible();

	// Back to the current month, edit the budget's amount.
	await page.getByRole('button', { name: 'Today' }).click();
	await page.getByRole('button', { name: 'Dining budget actions' }).click();
	await page.getByRole('menuitem', { name: 'Edit' }).click();
	dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('heading', { name: 'Edit budget' })).toBeVisible();
	await dialog.getByLabel('Amount', { exact: true }).fill('200');
	await dialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByText('of 200.00')).toBeVisible();

	// FR-012 regression case: the previous month's already-closed figure must stay 100.00, not
	// silently follow today's edit to 200.00 (research.md §4).
	await page.getByRole('button', { name: 'Previous month' }).click();
	await expect(page.getByText('of 100.00')).toBeVisible();
	await expect(page.getByText('of 200.00')).toHaveCount(0);

	// Back to today: delete with confirm, then undo.
	await page.getByRole('button', { name: 'Today' }).click();
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Dining budget actions' }).click();
	await page.getByRole('menuitem', { name: 'Delete' }).click();
	await expect(page.getByText('of 200.00')).toHaveCount(0);

	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByText('of 200.00')).toBeVisible();
});

// User Story 4 (spec 019, P2): envelope rollover 'full' mode carries an overspend deficit into
// the next period, distinct from the original positive-only rollover. See quickstart.md §4.
test('envelope rollover in full mode carries an overspend deficit into the next month', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('582013');
	await page.getByLabel('Confirm PIN').fill('582013');
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
	await categoryDialog.getByLabel('Name').fill('Envelope Test');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Budgets', exact: true }).click();
	await page.getByRole('button', { name: 'Add budget' }).click();
	const budgetDialog = page.getByRole('dialog');
	await budgetDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Envelope Test' }).click();
	await budgetDialog.getByLabel('Amount', { exact: true }).fill('100');
	await budgetDialog.getByLabel('Rollover mode').click();
	await page.getByRole('option', { name: /carry overspend forward/ }).click();
	await budgetDialog.getByRole('button', { name: 'Add budget' }).click();
	await expect(budgetDialog).not.toBeVisible();

	// Overspend THIS month by 50 (150 actual vs. 100 planned). Note: this month's BudgetItem was
	// already materialized (rolloverInAmount locked at 0) the instant the budget was created
	// above — ensureBudgetItemForPeriod never retroactively recomputes an already-existing
	// period's rollover, only its actualAmount (budgetEngine.ts's own documented "closed period"
	// precedent extends to rolloverInAmount for every period, not just closed ones). So the
	// deficit can only be observed on the *next* period's BudgetItem, which is materialized for
	// the first time below — after this month's actualAmount already reflects the overspend.
	await page.getByRole('link', { name: 'Transactions', exact: true }).click();
	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('150');
	await page.locator('button[role="combobox"]').filter({ hasText: 'Category…' }).click();
	await page.getByRole('option', { name: 'Envelope Test' }).click();
	await page.locator('input[placeholder="Amount"]').fill('150');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page).toHaveURL(/\/transactions$/);

	await page.getByRole('link', { name: 'Budgets', exact: true }).click();
	await expect(page.getByText('of 100.00')).toBeVisible(); // this month: 150 actual, still 100 planned

	// Next month's BudgetItem is created for the first time now, reading this month's
	// already-recalculated actualAmount: rollover = 100 planned - 150 actual = -50.
	await page.getByRole('button', { name: 'Next month' }).click();
	await expect(page.getByText('of 50.00')).toBeVisible();
	await expect(page.getByText(/deficit carried over from last period/)).toBeVisible();
});
