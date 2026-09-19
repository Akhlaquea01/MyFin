import { test, expect, type Page } from '@playwright/test';

// User Story 4 (P4): Quick Add paste flow proposes a transaction, and pasting the same
// text again is flagged as a likely duplicate rather than silently created twice.

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

async function chooseOption(page: Page, comboboxLabel: string, optionName: string) {
	await page.getByLabel(comboboxLabel).click();
	await page.getByRole('option', { name: optionName, exact: true }).click();
}

async function addTaggedCard(page: Page, name: string, last4: string) {
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await chooseOption(page, 'Type', 'Credit Card');
	await dialog.getByLabel('Last 4 digits (optional)').fill(last4);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

test('Quick Add proposes a transaction from pasted text and it appears in review', async ({
	page
}) => {
	await onboard(page, '818184');

	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('Checking');
	await dialog.getByLabel('Opening balance').fill('1000');
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();

	await goTo(page, 'Quick Add', 'Quick Add');
	await page
		.getByLabel('Paste a payment notification')
		.fill('Rs.250.00 debited from A/c XX1234 to Coffee Shop Ref No 999');
	await page.getByRole('button', { name: 'Parse' }).click();

	await expect(page.getByText("Couldn't confidently read")).not.toBeVisible();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();

	// Prefilled from integer paise at full currency precision; the old value came from
	// `(paise / 100).toString()`, which dropped trailing zeros.
	await expect(page.getByLabel('Amount')).toHaveValue('250.00');
	await expect(page.getByLabel('Merchant')).toHaveValue('Coffee Shop');

	await page.getByRole('button', { name: 'Confirm & add to review queue' }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
	await expect(page.getByText('Coffee Shop')).toBeVisible();
});

// spec 018, User Story 1 (FR-001-FR-006): Quick Add reuses the same tagged-card matching
// ImportPage/BulkTextImportPage already rely on (spec 017). Mirrors quickstart.md Scenario 1.
test.describe('Quick Add card auto-match', () => {
	test('single match pre-selects and is overridable, multi-match disambiguates, no match is unchanged, archived cards are excluded', async ({
		page
	}) => {
		await onboard(page, '204981');

		await goTo(page, 'Accounts', 'Accounts');
		await addTaggedCard(page, 'HDFC Card', '4321');
		await addTaggedCard(page, 'ICICI Card', '8765');
		await addTaggedCard(page, 'Old Card', '9999');
		await page.getByRole('button', { name: 'Add account' }).click();
		const bankDialog = page.getByRole('dialog');
		await bankDialog.getByLabel('Name').fill('Checking');
		await bankDialog.getByLabel('Opening balance').fill('1000');
		await bankDialog.getByRole('button', { name: 'Add account' }).click();
		await expect(bankDialog).not.toBeVisible();

		// Archive one tagged card — its identifier must never be offered as an auto-selected
		// destination afterward (FR-006).
		await page.getByRole('button', { name: 'Old Card actions' }).click();
		await page.getByRole('menuitem', { name: 'Archive' }).click();

		// --- Single match: pre-selected, with a reason shown, and still overridable (FR-002/FR-005) ---
		await goTo(page, 'Quick Add', 'Quick Add');
		await page
			.getByLabel('Paste a payment notification')
			.fill('Rs.500.00 debited from card ending 4321 at Amazon');
		await page.getByRole('button', { name: 'Parse' }).click();

		await expect(page.getByText(/Matched by card ending "4321"/)).toBeVisible();
		await expect(page.getByLabel('Account')).toHaveText('HDFC Card');

		await chooseOption(page, 'Account', 'Checking');
		await expect(page.getByLabel('Account')).toHaveText('Checking');

		// --- Multiple matches: no silent guess, disambiguation required (FR-003) ---
		await page
			.getByLabel('Paste a payment notification')
			.fill('Rs.300 from 4321 and related charge on 8765');
		await page.getByRole('button', { name: 'Parse' }).click();

		await expect(page.getByText(/matches more than one tagged card/)).toBeVisible();
		// Disambiguation never auto-picks (FR-003) — the field stays whatever it already was
		// (still "Checking" from the override above) until the user explicitly picks one.
		await expect(page.getByLabel('Account')).toHaveText('Checking');
		await page.getByRole('button', { name: 'ICICI Card (ending 8765)' }).click();
		await expect(page.getByLabel('Account')).toHaveText('ICICI Card');

		// --- No match: account field behaves exactly as it does today (FR-004) — nothing
		//     resets or touches whatever the field already held (same as before this feature,
		//     when a parse never looked at the account field at all) ---
		await page.getByLabel('Paste a payment notification').fill('Rs.100.00 debited at Local Store');
		await page.getByRole('button', { name: 'Parse' }).click();

		await expect(page.getByText(/Matched by/)).toHaveCount(0);
		await expect(page.getByText(/matches more than one/)).toHaveCount(0);
		await expect(page.getByLabel('Account')).toHaveText('ICICI Card');

		// --- Archived card's identifier never auto-selected (FR-006) ---
		await page
			.getByLabel('Paste a payment notification')
			.fill('Rs.100.00 debited from card ending 9999 at Somewhere');
		await page.getByRole('button', { name: 'Parse' }).click();

		await expect(page.getByText(/Matched by/)).toHaveCount(0);
		await expect(page.getByLabel('Account')).toHaveText('ICICI Card');
	});
});
