import { test, expect, type Page } from '@playwright/test';

// Feature 002 (Debt Payoff Planner), User Stories 1-3.
// Fixture deliberately makes avalanche and snowball disagree on ordering (quickstart.md):
// Card A has the smaller balance but the lower rate; Loan B has the larger balance but the
// higher rate.

async function fillNeedsInputRow(
	page: Page,
	liabilityName: string,
	apr: string,
	minPayment: string
) {
	const row = page.locator('div.rounded-lg.border', { hasText: liabilityName });
	await row.getByLabel('APR %').fill(apr);
	await row.getByLabel('Min. payment').fill(minPayment);
	await row.getByRole('button', { name: 'Save' }).click();
	// Saving encrypts, writes to IndexedDB and refetches; the click resolves long before any
	// of that lands. Wait for the row to leave the "Needs input" list so whatever the caller
	// asserts next is measuring saved state rather than racing the write.
	await expect(row).toHaveCount(0);
}

test('avalanche/snowball ordering, extra payment, and strategy comparison', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('909084');
	await page.getByLabel('Confirm PIN').fill('909084');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	// Two liabilities via the existing Liabilities page.
	await page.getByRole('link', { name: 'Liabilities' }).click();

	await page.getByRole('button', { name: 'Add liability' }).click();
	let dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Card A');
	await dialog.getByLabel('Type').click();
	await page.getByRole('option', { name: 'Credit Card' }).click();
	await dialog.getByLabel('Outstanding balance').fill('5000');
	await dialog.getByRole('button', { name: 'Add liability' }).click();
	await expect(dialog).not.toBeVisible();

	await page.getByRole('button', { name: 'Add liability' }).click();
	dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Loan B');
	await dialog.getByLabel('Outstanding balance').fill('50000');
	await dialog.getByRole('button', { name: 'Add liability' }).click();
	await expect(dialog).not.toBeVisible();

	// Open the planner (Scenario 5: both liabilities start out needing input).
	await page.getByRole('link', { name: 'Payoff Planner' }).click();
	await expect(page.getByRole('heading', { name: 'Debt Payoff Planner' })).toBeVisible();
	await expect(page.getByText('Needs input')).toBeVisible();

	// Fill Loan B first and leave it unsaved. Saving one row used to blank the entire page
	// while it refetched, unmounting every other row and discarding the user's in-progress
	// typing — so Loan B's details have to survive Card A's save.
	const loanBRow = page.locator('div.rounded-lg.border', { hasText: 'Loan B' });
	await loanBRow.getByLabel('APR %').fill('36');
	await loanBRow.getByLabel('Min. payment').fill('2000');

	await fillNeedsInputRow(page, 'Card A', '12', '500');
	await expect(loanBRow.getByLabel('APR %')).toHaveValue('36');
	await expect(loanBRow.getByLabel('Min. payment')).toHaveValue('2000');

	await loanBRow.getByRole('button', { name: 'Save' }).click();
	await expect(loanBRow).toHaveCount(0);
	await expect(page.getByText('Needs input')).not.toBeVisible();

	// Scenario 1: avalanche ranks Loan B (36%) above Card A (12%).
	const loanBCard = page.locator('[data-slot="card"]').filter({ hasText: 'Loan B' });
	const cardACard = page.locator('[data-slot="card"]').filter({ hasText: 'Card A' });
	await expect(loanBCard.getByText('#1')).toBeVisible();
	await expect(cardACard.getByText('#2')).toBeVisible();

	const avalancheSummary = page.locator('[data-slot="card"]').filter({ hasText: 'Plan summary' });
	const minimumsOnlyInterest = await avalancheSummary
		.getByText('Total interest')
		.locator('..')
		.textContent();

	// Scenario 2: snowball flips the order — Card A (smaller balance) ranks first.
	await page.getByRole('tab', { name: 'Snowball' }).click();
	await expect(cardACard.getByText('#1')).toBeVisible();
	await expect(loanBCard.getByText('#2')).toBeVisible();

	// Scenario 3: back to avalanche, add an extra payment — payoff moves sooner, interest drops.
	await page.getByRole('tab', { name: 'Avalanche' }).click();
	await page.getByLabel('Extra monthly payment').fill('1000');
	await expect(async () => {
		const withExtraInterest = await avalancheSummary
			.getByText('Total interest')
			.locator('..')
			.textContent();
		expect(withExtraInterest).not.toEqual(minimumsOnlyInterest);
	}).toPass();

	// Scenario 4: the avalanche/snowball comparison view is shown side by side.
	const comparisonCard = page
		.locator('[data-slot="card"]')
		.filter({ hasText: 'Avalanche vs. snowball' });
	await expect(comparisonCard).toBeVisible();
	await expect(comparisonCard.getByText('avalanche', { exact: true })).toBeVisible();
	await expect(comparisonCard.getByText('snowball', { exact: true })).toBeVisible();
});

// Scenario 6 (FR-010): a minimum payment that can't cover its own accruing interest is
// surfaced as a warning, not a broken or infinite-looking plan.
test('flags a liability whose minimum payment cannot cover its accruing interest', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('919184');
	await page.getByLabel('Confirm PIN').fill('919184');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Liabilities' }).click();
	await page.getByRole('button', { name: 'Add liability' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Stuck Card');
	await dialog.getByLabel('Outstanding balance').fill('50000');
	await dialog.getByRole('button', { name: 'Add liability' }).click();
	await expect(dialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Payoff Planner' }).click();

	// Saving an incomplete row used to do nothing at all, with no message explaining why.
	const stuckRow = page.locator('div.rounded-lg.border', { hasText: 'Stuck Card' });
	await stuckRow.getByRole('button', { name: 'Save' }).click();
	await expect(stuckRow.getByRole('alert')).toHaveText('Enter an APR of 0 or more.');
	await stuckRow.getByLabel('APR %').fill('36');
	await stuckRow.getByRole('button', { name: 'Save' }).click();
	await expect(stuckRow.getByRole('alert')).toHaveText(
		'Enter a minimum payment greater than zero.'
	);

	// 36% APR on ₹50,000 accrues ~₹1,500/mo interest; a ₹10/mo minimum can never cover it.
	await fillNeedsInputRow(page, 'Stuck Card', '36', '10');

	await expect(page.getByText("doesn't cover its accruing interest")).toBeVisible();
	const stuckCard = page.locator('[data-slot="card"]').filter({ hasText: 'Stuck Card' });
	await expect(stuckCard.getByText('Not reachable yet')).toBeVisible();
});
