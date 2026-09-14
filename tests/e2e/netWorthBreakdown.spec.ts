import { test, expect, type Page } from '@playwright/test';

// spec 017, User Story 2 (P2): net worth as labeled categories that sum exactly to the total,
// plus duplicate credit-card-debt detection with link/dismiss. Mirrors quickstart.md Scenario 2.

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

test('net worth breakdown sums exactly, drills down, and resolves a duplicate credit card', async ({
	page
}) => {
	await onboard(page, '998877');

	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	let dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Checking');
	await dialog.getByLabel('Opening balance').fill('1000');
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();

	await page.getByRole('button', { name: 'Add account' }).click();
	dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('HDFC Card');
	await chooseOption(page, 'Type', 'Credit Card');
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();

	await goTo(page, 'Transactions', 'Transactions');
	await page.getByRole('link', { name: 'New transaction' }).click();
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await chooseOption(page, 'Account', 'HDFC Card');
	await page.getByLabel('Amount').fill('350');
	await page.locator('input[type="date"]').fill('2026-01-15');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await goTo(page, 'Investments', 'Investments');
	await page.getByRole('button', { name: 'Add holding' }).click();
	dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Index Fund');
	await dialog.getByLabel('Units').fill('1');
	await dialog.getByLabel('Avg. price / unit').fill('500');
	await dialog.getByRole('button', { name: 'Add holding' }).click();
	await expect(dialog).not.toBeVisible();

	// FR-005/SC-002: distinct labeled categories summing exactly to the total.
	// cash 1000 + investments 500 - creditCardDebt 350 = 1150.
	await goTo(page, 'Net Worth', 'Net Worth');
	const netWorthCard = page.locator('[data-slot="card"]').filter({ hasText: 'Total Net Worth' });
	await expect(netWorthCard).toContainText('1,150.00');
	await expect(netWorthCard.getByText('Cash & bank balances')).toBeVisible();
	await expect(netWorthCard.getByText('Credit card debt')).toBeVisible();

	// FR-006: drill-down shows the contributing account.
	await netWorthCard.getByRole('button', { name: /Credit card debt/ }).click();
	await expect(netWorthCard.getByText('HDFC Card')).toBeVisible();
	await expect(netWorthCard.getByText('350.00', { exact: true })).toBeVisible();

	// FR-008/FR-009: a manual liability whose name matches the tracked card is flagged, and
	// linking it stops it from double-counting.
	await goTo(page, 'Liabilities', 'Liabilities');
	await page.getByRole('button', { name: 'Add liability' }).click();
	dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('HDFC Card');
	await chooseOption(page, 'Type', 'Credit Card');
	await dialog.getByLabel('Outstanding balance').fill('200');
	await dialog.getByRole('button', { name: 'Add liability' }).click();
	await expect(dialog.getByText(/already tracked from transactions/)).toBeVisible();
	await dialog.getByRole('button', { name: 'Link to HDFC Card instead' }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByText('Linked to HDFC Card')).toBeVisible();

	await goTo(page, 'Net Worth', 'Net Worth');
	// Still 1,150.00 — the linked liability did not double-count.
	await expect(netWorthCard).toContainText('1,150.00');

	// FR-010: choosing "these are different" lets a second, genuinely distinct entry count
	// independently even though its name still matched.
	await goTo(page, 'Liabilities', 'Liabilities');
	await page.getByRole('button', { name: 'Add liability' }).click();
	dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('HDFC Card Backup');
	await chooseOption(page, 'Type', 'Credit Card');
	await dialog.getByLabel('Outstanding balance').fill('100');
	await dialog.getByRole('button', { name: 'Add liability' }).click();
	await dialog.getByRole('button', { name: 'These are different — add anyway' }).click();
	await expect(dialog).not.toBeVisible();

	await goTo(page, 'Net Worth', 'Net Worth');
	// 1,150.00 - 100.00 (the new independent liability) = 1,050.00.
	await expect(netWorthCard).toContainText('1,050.00');
});
