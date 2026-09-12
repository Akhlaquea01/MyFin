import { test, expect, type Page } from '@playwright/test';

// Spec 012: tag-based filtering & search for transactions. Covers quickstart.md Scenarios
// 1 (filter by a single tag), 3 (multiple tags, OR), 5 (pick-list discovery/narrowing),
// 6 (no tags yet), and 8 (search by tag text via the existing search box).

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

async function addAccount(page: Page, name: string, openingBalance: string) {
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('heading', { name: 'New account' })).toBeVisible();
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Opening balance').fill(openingBalance);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

async function addTransaction(
	page: Page,
	opts: { account: string; amount: string; notes?: string; tags?: string }
) {
	await page.getByRole('link', { name: 'New transaction' }).click();
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await chooseOption(page, 'Account', opts.account);
	await page.getByLabel('Amount', { exact: true }).fill(opts.amount);
	if (opts.notes) await page.getByLabel('Notes').fill(opts.notes);
	if (opts.tags) await page.getByLabel('Tags (comma-separated)').fill(opts.tags);
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
}

/** Opens the tag filter popover; its content isn't nested under a labelled region. */
async function openTagFilter(page: Page) {
	await page.getByRole('button', { name: /tags? selected|all tags/i }).click();
}

test.describe('Tag filtering & search', () => {
	test('filters the transaction list by a single tag (Scenario 1)', async ({ page }) => {
		await onboard(page, '417953');
		await goTo(page, 'Accounts', 'Accounts');
		await addAccount(page, 'Checking', '1000');

		await goTo(page, 'Transactions', 'Transactions');
		await addTransaction(page, { account: 'Checking', amount: '500', tags: 'reimbursable' });
		await addTransaction(page, { account: 'Checking', amount: '300', notes: 'Groceries run' });

		await openTagFilter(page);
		await page.getByRole('button', { name: 'reimbursable', exact: true }).click();
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: 'Filter', exact: true }).click();

		await expect(page.getByRole('row', { name: /500\.00/ })).toBeVisible();
		await expect(page.getByText('Groceries run')).not.toBeVisible();
	});

	test('matches any of several selected tags (Scenario 3, OR semantics)', async ({ page }) => {
		await onboard(page, '417953');
		await goTo(page, 'Accounts', 'Accounts');
		await addAccount(page, 'Checking', '1000');

		await goTo(page, 'Transactions', 'Transactions');
		await addTransaction(page, { account: 'Checking', amount: '100', tags: 'trip:japan' });
		await addTransaction(page, { account: 'Checking', amount: '200', tags: 'reimbursable' });
		await addTransaction(page, { account: 'Checking', amount: '300', notes: 'Unrelated' });

		await openTagFilter(page);
		await page.getByRole('button', { name: 'trip:japan', exact: true }).click();
		await page.getByRole('button', { name: 'reimbursable', exact: true }).click();
		await page.keyboard.press('Escape');
		await page.getByRole('button', { name: 'Filter', exact: true }).click();

		await expect(page.getByRole('row', { name: /100\.00/ })).toBeVisible();
		await expect(page.getByRole('row', { name: /200\.00/ })).toBeVisible();
		await expect(page.getByText('Unrelated')).not.toBeVisible();
	});

	test('narrows the tag pick-list by typing (Scenario 5)', async ({ page }) => {
		await onboard(page, '417953');
		await goTo(page, 'Accounts', 'Accounts');
		await addAccount(page, 'Checking', '1000');

		await goTo(page, 'Transactions', 'Transactions');
		await addTransaction(page, { account: 'Checking', amount: '100', tags: 'trip:japan' });
		await addTransaction(page, { account: 'Checking', amount: '200', tags: 'trip:goa' });
		await addTransaction(page, { account: 'Checking', amount: '300', tags: 'reimbursable' });

		await openTagFilter(page);
		await expect(page.getByRole('button', { name: 'trip:japan', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'trip:goa', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'reimbursable', exact: true })).toBeVisible();

		await page.getByPlaceholder('Search tags…').fill('trip');
		await expect(page.getByRole('button', { name: 'trip:japan', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'trip:goa', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'reimbursable', exact: true })).not.toBeVisible();
	});

	test('shows a clear empty state when no tags exist yet (Scenario 6)', async ({ page }) => {
		await onboard(page, '417953');
		await goTo(page, 'Accounts', 'Accounts');
		await addAccount(page, 'Checking', '1000');

		await goTo(page, 'Transactions', 'Transactions');
		await addTransaction(page, { account: 'Checking', amount: '100', notes: 'No tags here' });

		await openTagFilter(page);
		await expect(page.getByText('No tags yet.')).toBeVisible();
	});

	test('the existing search box also matches tag text (Scenario 8)', async ({ page }) => {
		await onboard(page, '417953');
		await goTo(page, 'Accounts', 'Accounts');
		await addAccount(page, 'Checking', '1000');

		await goTo(page, 'Transactions', 'Transactions');
		await addTransaction(page, { account: 'Checking', amount: '500', tags: 'trip:japan' });
		await addTransaction(page, { account: 'Checking', amount: '300', notes: 'Groceries run' });

		await page.getByLabel('Search (notes or tags)').fill('japan');
		await page.getByRole('button', { name: 'Filter', exact: true }).click();

		await expect(page.getByRole('row', { name: /500\.00/ })).toBeVisible();
		await expect(page.getByText('Groceries run')).not.toBeVisible();
	});
});
