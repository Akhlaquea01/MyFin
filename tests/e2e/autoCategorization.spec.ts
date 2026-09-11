import { test, expect, type Page } from '@playwright/test';

// Feature 006 (Auto-Categorization Rules & Learning), Stories 1-3.

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

async function addAccount(page: Page, name: string) {
	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Opening balance').fill('10000');
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

async function addCategory(page: Page, name: string) {
	await goTo(page, 'Categories', 'Categories');
	await page.getByRole('button', { name: 'Add category' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByRole('button', { name: 'Add category' }).click();
	await expect(dialog).not.toBeVisible();
}

/** Pastes a Quick Add message for `merchant`/`amount` and confirms it into the review queue. */
async function quickAdd(page: Page, accountName: string, merchant: string, amount: string) {
	await goTo(page, 'Quick Add', 'Quick Add');
	await page
		.getByLabel('Paste a payment notification')
		.fill(`Rs.${amount} debited from A/c XX1234 to ${merchant} Ref No ${Math.random()}`);
	await page.getByRole('button', { name: 'Parse' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: accountName, exact: true }).click();
	await page.getByRole('button', { name: 'Confirm & add to review queue' }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
}

/** In the Review Queue, sets `merchant`'s pending item to `category` and confirms it. */
async function confirmInReview(page: Page, merchant: string, category: string) {
	const card = page.locator('[data-slot="card"]').filter({ hasText: merchant });
	await card.getByLabel('Category').click();
	await page.getByRole('option', { name: category, exact: true }).click();
	await card.getByRole('button', { name: 'Confirm transaction' }).click();
	await expect(card).not.toBeVisible();
}

test('an explicit rule pre-fills every new proposal, visibly different from a suggestion, and beats one', async ({
	page
}) => {
	await onboard(page, '616184');
	await addAccount(page, 'Checking');
	await addCategory(page, 'Dining');
	await addCategory(page, 'Shopping');

	// First sighting of "Coffee Shop": no rule yet, so it lands uncategorized until confirmed.
	await quickAdd(page, 'Checking', 'Coffee Shop', '250.00');
	await confirmInReview(page, 'Coffee Shop', 'Dining');

	// Story 1: create an explicit rule for this merchant.
	await goTo(page, 'Auto-Categorize', 'Auto-Categorize');
	await page.getByRole('button', { name: 'Add rule' }).click();
	let dialog = page.getByRole('dialog');
	await dialog.getByLabel('Merchant').click();
	await page.getByRole('option', { name: 'Coffee Shop', exact: true }).click();
	await dialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Dining', exact: true }).click();
	await dialog.getByRole('button', { name: 'Add rule' }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByText('Any alias → Dining')).toBeVisible();

	// Every new proposal from this merchant now arrives pre-filled — no "Suggested" badge
	// (that's reserved for a learned suggestion, not an explicit rule) — and the user can
	// still confirm it as-is (Acceptance Scenario 3).
	await quickAdd(page, 'Checking', 'Coffee Shop', '300.00');
	await goTo(page, 'Review', 'Review Queue');
	const preFilledCard = page.locator('[data-slot="card"]').filter({ hasText: 'Coffee Shop' });
	await expect(preFilledCard.getByLabel('Category')).toHaveText('Dining');
	await expect(preFilledCard.getByText('Suggested')).not.toBeVisible();
	await preFilledCard.getByRole('button', { name: 'Confirm transaction' }).click();
	await expect(preFilledCard).not.toBeVisible();

	// Editing the rule only changes future proposals — not the already-confirmed ones above.
	await goTo(page, 'Auto-Categorize', 'Auto-Categorize');
	await page.getByRole('button', { name: 'Edit rule' }).click();
	dialog = page.getByRole('dialog');
	await dialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Shopping', exact: true }).click();
	await dialog.getByRole('button', { name: 'Save changes' }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByText('Any alias → Shopping')).toBeVisible();

	await quickAdd(page, 'Checking', 'Coffee Shop', '150.00');
	await goTo(page, 'Review', 'Review Queue');
	const latestCard = page.locator('[data-slot="card"]').filter({ hasText: 'Coffee Shop' });
	await expect(latestCard.getByLabel('Category')).toHaveText('Shopping');
});

test('a learned suggestion appears after a consistent streak, and can be promoted or reset', async ({
	page
}) => {
	await onboard(page, '626284');
	await addAccount(page, 'Checking');
	await addCategory(page, 'Transport');

	// No rule for "Uber" — confirm three transactions into the same category by hand.
	for (const amount of ['100.00', '120.00', '90.00']) {
		await quickAdd(page, 'Checking', 'Uber', amount);
		await confirmInReview(page, 'Uber', 'Transport');
	}

	// A fourth proposal arrives pre-filled, badged as a suggestion (FR-004).
	await quickAdd(page, 'Checking', 'Uber', '110.00');
	await goTo(page, 'Review', 'Review Queue');
	const suggestedCard = page.locator('[data-slot="card"]').filter({ hasText: 'Uber' });
	await expect(suggestedCard.getByLabel('Category')).toHaveText('Transport');
	await expect(suggestedCard.getByText('Suggested')).toBeVisible();
	await suggestedCard.getByRole('button', { name: 'Confirm transaction' }).click();

	// Story 3: promote the suggestion into a permanent rule.
	await goTo(page, 'Auto-Categorize', 'Auto-Categorize');
	await expect(page.getByText('Uber → Transport')).toBeVisible();
	await page.getByRole('button', { name: 'Promote' }).click();
	await expect(page.getByText('Any alias → Transport')).toBeVisible();

	await quickAdd(page, 'Checking', 'Uber', '130.00');
	await goTo(page, 'Review', 'Review Queue');
	const ruleCard = page.locator('[data-slot="card"]').filter({ hasText: 'Uber' });
	await expect(ruleCard.getByLabel('Category')).toHaveText('Transport');
	await expect(ruleCard.getByText('Suggested')).not.toBeVisible();
	await ruleCard.getByRole('button', { name: 'Confirm transaction' }).click();

	// Separately: resetting a suggestion (for a different, rule-free merchant) stops
	// pre-filling until a fresh streak re-forms.
	for (const amount of ['40.00', '45.00', '50.00']) {
		await quickAdd(page, 'Checking', 'Metro', amount);
		await confirmInReview(page, 'Metro', 'Transport');
	}
	await goTo(page, 'Auto-Categorize', 'Auto-Categorize');
	const metroSuggestion = page
		.locator('[data-slot="card"]')
		.filter({ hasText: 'Metro → Transport' });
	await expect(metroSuggestion).toBeVisible();
	await metroSuggestion.getByRole('button', { name: 'Reset' }).click();
	await expect(page.getByText('Metro → Transport')).not.toBeVisible();

	await quickAdd(page, 'Checking', 'Metro', '55.00');
	await goTo(page, 'Review', 'Review Queue');
	const resetCard = page.locator('[data-slot="card"]').filter({ hasText: 'Metro' });
	await expect(resetCard.getByLabel('Category')).toHaveText('Uncategorized');
});
