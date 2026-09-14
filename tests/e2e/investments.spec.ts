import { test, expect } from '@playwright/test';

// spec 017, User Story 4 (P4): portfolio-level aggregate totals, by-type breakdown, and an
// "estimated" indicator for a holding with no recorded valuation. Mirrors quickstart.md
// Scenario 4.

test('investment portfolio aggregate totals, by-type breakdown, and estimated badge', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('648213');
	await page.getByLabel('Confirm PIN').fill('648213');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Investments' }).click();
	await expect(page.getByRole('heading', { name: 'Investments' })).toBeVisible();

	async function addHolding(name: string, type: string, units: string, avgPrice: string) {
		await page.getByRole('button', { name: 'Add holding' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Name').fill(name);
		await dialog.getByLabel('Type').click();
		await page.getByRole('option', { name: type, exact: true }).click();
		await dialog.getByLabel('Units').fill(units);
		await dialog.getByLabel('Avg. price / unit').fill(avgPrice);
		await dialog.getByRole('button', { name: 'Add holding' }).click();
		await expect(dialog).not.toBeVisible();
	}

	await addHolding('BEL', 'Stock', '10', '100');
	await addHolding('Gold', 'Other', '1', '500');

	// Record a gain on BEL; Gold is left with no recorded valuation (estimated).
	const belCard = page.locator('[data-slot="card"]').filter({ hasText: 'BEL' });
	await belCard.getByRole('button', { name: 'Update value' }).click();
	const valueDialog = page.getByRole('dialog');
	await valueDialog.getByLabel('Current value').fill('1200');
	await valueDialog.getByRole('button', { name: 'Save' }).click();
	await expect(valueDialog).not.toBeVisible();

	// FR-016/FR-017/SC-005: aggregate totals and by-type breakdown, visible without navigating
	// away from the Investments page.
	const summaryCard = page.locator('[data-slot="card"]').filter({ hasText: 'Portfolio Summary' });
	await expect(summaryCard).toContainText('1,700.00'); // 1200 (BEL) + 500 (Gold, cost basis)
	await expect(summaryCard).toContainText('Invested 1,500.00'); // 1000 (BEL) + 500 (Gold)
	await expect(summaryCard).toContainText('200.00 (+13.33%)'); // gain
	await expect(summaryCard).toContainText('+13.33%');
	await expect(summaryCard.getByText('Stock')).toBeVisible();
	await expect(summaryCard.getByText('Other')).toBeVisible();
	await expect(summaryCard.getByText('(est.)')).toBeVisible();

	// FR-018: the individual holding with no recorded valuation is also marked as an estimate.
	const goldCard = page.locator('[data-slot="card"]').filter({ hasText: 'Gold' });
	await expect(goldCard.getByText('estimated (cost basis)')).toBeVisible();
	await expect(belCard.getByText('estimated (cost basis)')).toHaveCount(0);
});
