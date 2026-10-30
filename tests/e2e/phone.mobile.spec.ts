import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The phone layout, on a phone profile: the screens people use every day must fit the screen, be
// reachable by thumb and work without a mouse.

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/** An account tagged "1234", two categories and a few entries this month, through the app's own
 *  data-template import so each test starts with something to look at. */
async function seed(page: Page) {
	const now = new Date();
	const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
		.toISOString()
		.slice(0, 10);
	const stamp = now.getTime();
	const base = { createdAt: stamp, updatedAt: stamp };
	const entities: Record<string, unknown[]> = {
		accounts: [
			{
				id: 'acc',
				name: 'HDFC Savings',
				type: 'bank',
				openingBalance: 5_000_000,
				currentBalance: 5_000_000,
				creditLimit: null,
				billingCycleDay: null,
				isArchived: false,
				accountLast4: '1234',
				...base
			}
		],
		categories: [
			{ id: 'cat-food', name: 'Food', parentId: null, icon: null, ...base },
			{ id: 'cat-transport', name: 'Transport', parentId: null, icon: null, ...base },
			{ id: 'cat-salary', name: 'Salary', parentId: null, icon: null, ...base }
		],
		transactions: [],
		transactionSplits: []
	};
	for (const k of [
		'merchants',
		'merchantAliases',
		'tags',
		'investmentHoldings',
		'investmentValuations',
		'liabilities',
		'netWorthSnapshots',
		'savingsGoals',
		'goalContributions',
		'budgets',
		'budgetItems',
		'recurringRules',
		'expectedEvents',
		'categorizationRules',
		'merchantCategorySignals',
		'transactionTags',
		'attachments'
	]) {
		entities[k] = [];
	}
	[
		['salary', 8_000_000, 'cat-salary'],
		['lunch', -120_000, 'cat-food'],
		['cab', -45_000, 'cat-transport']
	].forEach(([name, amount, category], i) => {
		entities.transactions.push({
			id: `tx-${name}`,
			accountId: 'acc',
			date: first,
			amount,
			type: (amount as number) < 0 ? 'expense' : 'income',
			transferPairId: null,
			merchantId: null,
			notes: name,
			source: 'manual',
			reviewStatus: 'confirmed',
			duplicateOfId: null,
			...base,
			createdAt: stamp + i
		});
		entities.transactionSplits.push({
			id: `ts-${name}`,
			transactionId: `tx-${name}`,
			categoryId: category,
			amount
		});
	});
	const file = join(mkdtempSync(join(tmpdir(), 'myfin-mobile-')), 'seed.json');
	writeFileSync(
		file,
		JSON.stringify({
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: now.toISOString(),
			entities: { ...entities, notificationPreference: null, debtPlannerPreference: null }
		})
	);
	await page.goto('/export');
	await page.locator('input[type="file"]').setInputFiles(file);
	await expect(page.getByText('Template imported successfully').first()).toBeVisible();
}

const noSideScroll = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

const MESSAGE = 'Rs.250.00 debited from A/c XX1234 to SWIGGY';

async function quickAdd(page: Page) {
	await page.goto('/quick-add');
	await page.getByLabel('Paste a payment notification').fill(MESSAGE);
	await page.getByRole('button', { name: 'Parse' }).click();
}

test('the dashboard fits a phone and shows where the money went', async ({ page }) => {
	await onboard(page, '727201');
	await seed(page);

	await page.goto('/');
	await expect(page.getByText('Where it went')).toBeVisible();
	const spending = page.locator('[data-slot="card"]').filter({ hasText: 'Where it went' });
	await expect(spending.getByText('Food')).toBeVisible();
	await expect(spending.getByText('Transport')).toBeVisible();
	await expect(page.getByText('Last 6 months')).toBeVisible();

	expect(await noSideScroll(page)).toBe(true);
	// The thumb bar is there, with the Review shortcut.
	await expect(page.getByRole('link', { name: 'Review queue' })).toBeVisible();
});

test('a pasted bank message finds its account, and the category is picked by typing', async ({
	page
}) => {
	await onboard(page, '727202');
	await seed(page);
	await quickAdd(page);

	// "A/c XX1234" names the bank account, which has no card digits at all.
	await expect(page.getByText(/Matched by account ending "1234"/)).toBeVisible();
	await expect(page.getByLabel('Account')).toContainText('HDFC Savings');

	await page.getByRole('combobox', { name: 'Category' }).click();
	const sheet = page.getByRole('dialog');
	await expect(sheet).toBeVisible();
	await sheet.getByPlaceholder('Type to search categories…').fill('tra');
	await expect(sheet.getByRole('option')).toHaveCount(1);
	await sheet.getByRole('option', { name: 'Transport' }).click();
	await expect(sheet).not.toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Category' })).toContainText('Transport');

	expect(await noSideScroll(page)).toBe(true);
	await page.getByRole('button', { name: 'Add to review queue' }).click();

	// The chosen category is on the card in Review, and one tap confirms it.
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Category' })).toContainText('Transport');
	expect(await noSideScroll(page)).toBe(true);
	await page.getByRole('button', { name: 'Confirm transaction' }).click();
	await expect(page.getByText('Nothing to review.')).toBeVisible();
});

test('a possible duplicate shows what it matches, and "Keep both" settles it', async ({ page }) => {
	await onboard(page, '727203');
	await seed(page);

	await quickAdd(page);
	await page.getByRole('button', { name: 'Add to review queue' }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();

	await quickAdd(page);
	await page.getByRole('button', { name: 'Add to review queue' }).click();
	await expect(page.getByText('This looks like something you already have.')).toBeVisible();
	await page.getByRole('button', { name: 'Add anyway' }).click();

	await expect(page.getByText('Possible duplicate')).toBeVisible();
	const compare = page.getByTestId('duplicate-compare');
	await expect(compare).toBeVisible();
	await expect(compare).toContainText('waiting in Review');
	await expect(
		compare.getByRole('button', { name: 'Same payment — remove this one' })
	).toBeVisible();
	expect(await noSideScroll(page)).toBe(true);

	await compare.getByRole('button', { name: 'Keep both' }).click();
	await expect(page.getByText('Kept both')).toBeVisible();
	await expect(page.getByText('Possible duplicate')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Confirm transaction' })).toHaveCount(2);
});

test('the bottom bar shows where you are and its tabs leave no Back trail', async ({ page }) => {
	await onboard(page, '727205');
	const bar = page.getByRole('navigation', { name: 'Primary shortcuts' });
	const more = bar.getByRole('button', { name: 'More' });

	await bar.getByRole('link', { name: 'Transactions' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	await bar.getByRole('link', { name: 'Review queue' }).click();
	await expect(page.getByRole('heading', { name: 'Review Queue' })).toBeVisible();
	await bar.getByRole('link', { name: 'Home' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	// Every tab swapped the entry, so there is nothing behind the first screen to step back through.
	expect(await page.evaluate(() => (window.history.state as { idx: number }).idx)).toBe(0);
	await expect(more).not.toHaveClass(/text-primary/);

	// A page below a tab keeps the tab lit; a screen with no tab lights More.
	await page.goto('/transactions/new');
	await expect(bar.getByRole('link', { name: 'Transactions' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(more).not.toHaveClass(/text-primary/);
	await page.goto('/net-worth');
	await expect(more).toHaveClass(/text-primary/);
});

test('related screens are one tap apart on a phone', async ({ page }) => {
	await onboard(page, '727204');
	await page.goto('/budgets');
	const strip = page.getByRole('navigation', { name: 'Plan screens' });
	await expect(strip).toBeVisible();
	await expect(strip.getByRole('link', { name: 'Budgets' })).toHaveAttribute(
		'aria-current',
		'page'
	);

	await strip.getByRole('link', { name: 'Goals' }).click();
	await expect(page.getByRole('heading', { name: 'Savings Goals' })).toBeVisible();
	await expect(strip.getByRole('link', { name: 'Goals' })).toHaveAttribute('aria-current', 'page');
	expect(await noSideScroll(page)).toBe(true);
});
