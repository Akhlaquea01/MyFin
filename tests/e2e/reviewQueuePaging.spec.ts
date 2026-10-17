import { test, expect, type Page } from '@playwright/test';
import { acceptConfirm, openScreen } from './helpers';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A big import leaves a long Review Queue. The page shows it in slices of 50 (newest first) instead of
// decrypting and drawing every entry at once, and "Confirm all categorized" still reaches the entries
// that are not on screen.

const WAITING = 60;
const PAGE = 50;

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function goTo(page: Page, linkName: string, headingName: string) {
	await page.getByRole('link', { name: linkName, exact: true }).click();
	await expect(page.getByRole('heading', { name: headingName })).toBeVisible();
}

/** An account, a "Food" category and a keyword rule filing "store" under it, then WAITING imported lines. */
async function seedLongQueue(page: Page, pin: string) {
	await onboard(page, pin);

	await goTo(page, 'Accounts', 'Accounts');
	await page.getByRole('button', { name: 'Add account' }).click();
	const accountDialog = page.getByRole('dialog');
	await accountDialog.getByLabel('Name').fill('Checking');
	await accountDialog.getByLabel('Opening balance').fill('100000');
	await accountDialog.getByRole('button', { name: 'Add account' }).click();
	await expect(accountDialog).not.toBeVisible();

	await goTo(page, 'Categories', 'Categories');
	await page.getByRole('button', { name: 'Add category' }).click();
	const categoryDialog = page.getByRole('dialog');
	await categoryDialog.getByLabel('Name').fill('Food');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await openScreen(page, 'Automation', 'Auto-Categorize');
	await expect(page.getByRole('heading', { name: 'Auto-Categorize' })).toBeVisible();
	await page.getByRole('button', { name: 'Add rule' }).click();
	const ruleDialog = page.getByRole('dialog');
	await ruleDialog.getByRole('radio', { name: 'Match description text' }).click();
	await ruleDialog.getByLabel('Description contains').fill('store');
	await ruleDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Food', exact: true }).click();
	await ruleDialog.getByRole('button', { name: 'Add rule' }).click();
	await expect(ruleDialog).not.toBeVisible();

	// Distinct amounts, so none of them is flagged as a repeat of another.
	const lines = Array.from(
		{ length: WAITING },
		(_, i) => `Rs.${101 + i} debited at Local Store ${i}`
	);
	const file = join(mkdtempSync(join(tmpdir(), 'myfin-e2e-')), 'long-queue.txt');
	writeFileSync(file, lines.join('\n'));

	await goTo(page, 'Review', 'Review Queue');
	await page.getByRole('link', { name: 'Bulk import' }).click();
	await expect(page.getByRole('heading', { name: 'Bulk Text Import' })).toBeVisible();
	await page.locator('input[type="file"]').setInputFiles(file);
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByRole('button', { name: /Import \d+ line/ }).click();
	await expect(page.getByText(`Created ${WAITING} unreviewed transactions`)).toBeVisible();
	await page.getByRole('link', { name: 'Go to review queue' }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
}

test('a long queue loads a page at a time, keeps your edits, and shows the rest on request', async ({
	page
}) => {
	await seedLongQueue(page, '505051');

	const confirmButtons = page.getByRole('button', { name: 'Confirm transaction' });
	await expect(page.getByText(`${WAITING} waiting (showing the newest ${PAGE})`)).toBeVisible();
	await expect(confirmButtons).toHaveCount(PAGE);
	const more = page.getByRole('button', { name: /Show 10 more \(10 not shown\)/ });
	await expect(more).toBeVisible();

	// Something typed on a row on screen (the second one — the first is discarded below). Tags sit
	// under "More options" on each card.
	await page.getByText('More options').nth(1).click();
	await page.getByLabel('Tags (comma-separated)').nth(1).fill('keepme');

	// Triage shrinks the page and the count together.
	await page.getByRole('button', { name: 'Discard transaction' }).first().click();
	await acceptConfirm(page, 'Discard this entry?');
	await expect(page.getByText('Discarded')).toBeVisible();
	await expect(confirmButtons).toHaveCount(PAGE - 1);
	await expect(
		page.getByText(`${WAITING - 1} waiting (showing the newest ${PAGE - 1})`)
	).toBeVisible();

	// "Show more" counts from what is on screen: 49 shown + a page, capped by what is left.
	await page.getByRole('button', { name: /Show \d+ more/ }).click();
	await expect(confirmButtons).toHaveCount(WAITING - 1);
	await expect(page.getByRole('button', { name: /Show \d+ more/ })).toHaveCount(0);
	await expect(page.getByText(`${WAITING - 1} waiting ·`)).toBeVisible();
	// Loading more did not reset what was typed on a row that was already there.
	await expect(page.getByLabel('Tags (comma-separated)').first()).toHaveValue('keepme');
});

test('"Confirm all categorized" confirms the entries that are not on the page too', async ({
	page
}) => {
	await seedLongQueue(page, '505052');
	await expect(page.getByRole('button', { name: 'Confirm transaction' })).toHaveCount(PAGE);

	await page.getByRole('button', { name: 'Confirm all categorized' }).click();
	// All of the queue, and an honest note of how many of those the user has not seen.
	await acceptConfirm(page, `Confirm ${WAITING} categorized entries`);

	await expect(page.getByText(`Confirmed ${WAITING} entries`)).toBeVisible();
	await expect(page.getByText('Nothing to review.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Confirm transaction' })).toHaveCount(0);

	// They kept the category they were filed with.
	await goTo(page, 'Transactions', 'Transactions');
	// (The list is virtualized, so this looks at the rows drawn — which includes entries that were
	// not on the Review page when the button was pressed, as the importer gives them all one date.)
	const storeRows = page.getByRole('row').filter({ hasText: 'LOCAL STORE' });
	await expect(storeRows.first().getByText('Food')).toBeVisible();
	await expect(storeRows.filter({ hasText: 'Uncategorized' })).toHaveCount(0);
});

test('discarding down to an empty page brings the next entries in rather than saying the queue is empty', async ({
	page
}) => {
	await seedLongQueue(page, '505053');
	const discard = page.getByRole('button', { name: 'Discard transaction' });
	await expect(discard).toHaveCount(PAGE);

	// Clear the whole first page; 10 entries are still waiting behind it. Each discard is awaited so
	// the next click cannot land on a row that is already on its way out.
	for (let i = 0; i < PAGE - 1; i++) {
		await discard.first().click();
		await acceptConfirm(page);
		await expect(discard).toHaveCount(PAGE - 1 - i);
	}
	await discard.first().click();
	await acceptConfirm(page);

	await expect(page.getByText('Nothing to review.')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Confirm transaction' })).toHaveCount(
		WAITING - PAGE
	);
	await expect(page.getByText(`${WAITING - PAGE} waiting ·`)).toBeVisible();
});
