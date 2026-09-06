import { test, expect, type Page } from '@playwright/test';

// Feature 004 (Recurring & Budget Notifications), User Stories 1-3.
// Playwright cannot observe a real OS notification popup, so each test installs a fake
// `Notification` global (via addInitScript, before any app script runs) that records every
// dispatched notification into `window.__notifications` instead of showing one — this lets
// permission state and dispatch content be asserted deterministically.

async function installFakeNotification(page: Page, permission: 'granted' | 'denied') {
	await page.addInitScript((perm) => {
		(window as unknown as { __notifications: unknown[] }).__notifications = [];
		class FakeNotification {
			static permission = perm;
			static requestPermission() {
				return Promise.resolve(perm);
			}
			constructor(title: string, options?: { body?: string; tag?: string }) {
				(window as unknown as { __notifications: unknown[] }).__notifications.push({
					title,
					body: options?.body,
					tag: options?.tag
				});
			}
		}
		// @ts-expect-error -- replacing the global for deterministic E2E assertions
		window.Notification = FakeNotification;
	}, permission);
}

async function getDispatchedNotifications(page: Page): Promise<{ title: string; body: string }[]> {
	return page.evaluate(
		() =>
			(window as unknown as { __notifications: { title: string; body: string }[] }).__notifications
	);
}

async function unlock(page: Page, pin: string) {
	await page.getByLabel('PIN').fill(pin);
	await page.getByRole('button', { name: 'Unlock' }).click();
	// Route-independent: a reload from a non-Dashboard page stays on that page's route once
	// unlocked, so check the nav (always present) rather than a page-specific heading.
	await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
	// runNotificationCheck() is fire-and-forget from handleUnlock; give its awaits a beat.
	await page.waitForTimeout(500);
}

function tomorrowWeekday(): number {
	const d = new Date();
	return (d.getUTCDay() + 1) % 7;
}

test('recurring reminder fires once per occurrence, then stays silent on the next unlock', async ({
	page
}) => {
	await installFakeNotification(page, 'granted');
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('3030');
	await page.getByLabel('Confirm PIN').fill('3030');
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
	await categoryDialog.getByLabel('Name').fill('Rent');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Recurring', exact: true }).click();
	await page.getByRole('button', { name: 'Add rule' }).click();
	const ruleDialog = page.getByRole('dialog');
	await ruleDialog.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking' }).click();
	await ruleDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Rent' }).click();
	await ruleDialog.getByLabel('Frequency').click();
	await page.getByRole('option', { name: 'Weekly' }).click();
	await ruleDialog.getByLabel('Day').fill(String(tomorrowWeekday()));
	await ruleDialog.getByLabel('Amount').fill('1000');
	await ruleDialog.getByRole('button', { name: 'Add rule' }).click();
	await expect(ruleDialog).not.toBeVisible();

	// First unlock after the rule exists: the reminder should fire.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
	await unlock(page, '3030');

	const firstCheck = await getDispatchedNotifications(page);
	expect(firstCheck).toHaveLength(1);
	expect(firstCheck[0].title).toContain('Rent');

	// Second unlock, same still-pending occurrence: must not notify again (FR-004).
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
	await unlock(page, '3030');

	const secondCheck = await getDispatchedNotifications(page);
	expect(secondCheck).toHaveLength(0);
});

test('denied permission dispatches nothing but the event stays visible in-app (FR-007)', async ({
	page
}) => {
	await installFakeNotification(page, 'denied');
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('3031');
	await page.getByLabel('Confirm PIN').fill('3031');
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
	await categoryDialog.getByLabel('Name').fill('Rent');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Recurring', exact: true }).click();
	await page.getByRole('button', { name: 'Add rule' }).click();
	const ruleDialog = page.getByRole('dialog');
	await ruleDialog.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking' }).click();
	await ruleDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Rent' }).click();
	await ruleDialog.getByLabel('Frequency').click();
	await page.getByRole('option', { name: 'Weekly' }).click();
	await ruleDialog.getByLabel('Day').fill(String(tomorrowWeekday()));
	await ruleDialog.getByLabel('Amount').fill('1000');
	await ruleDialog.getByRole('button', { name: 'Add rule' }).click();
	await expect(ruleDialog).not.toBeVisible();

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
	await unlock(page, '3031');

	expect(await getDispatchedNotifications(page)).toHaveLength(0);

	await page.getByRole('link', { name: 'Recurring', exact: true }).click();
	await page.getByRole('link', { name: 'Upcoming' }).click();
	const rentRow = page.locator('div.rounded-lg.border', { hasText: 'Rent' }).first();
	await expect(rentRow).toBeVisible();
	await expect(rentRow.getByText('pending')).toBeVisible();
});

test('budget threshold alert fires once per period', async ({ page }) => {
	await installFakeNotification(page, 'granted');
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('3032');
	await page.getByLabel('Confirm PIN').fill('3032');
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
	await categoryDialog.getByLabel('Name').fill('Dining');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Budgets' }).click();
	await page.getByRole('button', { name: 'Add budget' }).click();
	const budgetDialog = page.getByRole('dialog');
	await budgetDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Dining' }).click();
	await budgetDialog.getByLabel('Amount', { exact: true }).fill('100');
	await budgetDialog.getByRole('button', { name: 'Add budget' }).click();
	await expect(budgetDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Transactions' }).click();
	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('82');
	await page.locator('button[role="combobox"]').filter({ hasText: 'Category…' }).click();
	await page.getByRole('option', { name: 'Dining' }).click();
	await page.locator('input[placeholder="Amount"]').fill('82');
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
	await unlock(page, '3032');

	const firstCheck = await getDispatchedNotifications(page);
	expect(firstCheck).toHaveLength(1);
	expect(firstCheck[0].title).toContain('Dining');
	expect(firstCheck[0].body).toContain('82%');

	// More spend in the same period must not re-notify the same 80% threshold (FR-004).
	await page.getByRole('link', { name: 'Transactions' }).click();
	await page.getByRole('link', { name: 'New transaction' }).click();
	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('5');
	await page.locator('button[role="combobox"]').filter({ hasText: 'Category…' }).click();
	await page.getByRole('option', { name: 'Dining' }).click();
	await page.locator('input[placeholder="Amount"]').fill('5');
	await page.getByRole('button', { name: 'Save transaction' }).click();

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
	await unlock(page, '3032');

	expect(await getDispatchedNotifications(page)).toHaveLength(0);
});

test('disabling notifications suppresses all dispatch even with qualifying data and granted permission', async ({
	page
}) => {
	await installFakeNotification(page, 'granted');
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('3033');
	await page.getByLabel('Confirm PIN').fill('3033');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Notifications' }).click();
	await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
	await page.getByLabel('Enable notifications').click();

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
	await categoryDialog.getByLabel('Name').fill('Rent');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	await page.getByRole('link', { name: 'Recurring', exact: true }).click();
	await page.getByRole('button', { name: 'Add rule' }).click();
	const ruleDialog = page.getByRole('dialog');
	await ruleDialog.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking' }).click();
	await ruleDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Rent' }).click();
	await ruleDialog.getByLabel('Frequency').click();
	await page.getByRole('option', { name: 'Weekly' }).click();
	await ruleDialog.getByLabel('Day').fill(String(tomorrowWeekday()));
	await ruleDialog.getByLabel('Amount').fill('1000');
	await ruleDialog.getByRole('button', { name: 'Add rule' }).click();
	await expect(ruleDialog).not.toBeVisible();

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
	await unlock(page, '3033');

	expect(await getDispatchedNotifications(page)).toHaveLength(0);
});

// Scenario 5 (quickstart.md): a changed reminder lead time takes effect on the next check —
// a rule due in 2 days is outside the 1-day default but qualifies once the lead time is 3.
test('a widened reminder lead time picks up a previously out-of-window event', async ({ page }) => {
	await installFakeNotification(page, 'granted');
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('3034');
	await page.getByLabel('Confirm PIN').fill('3034');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Notifications' }).click();
	await page.getByLabel('Recurring reminder lead time (days)').fill('3');
	await page.getByLabel('Recurring reminder lead time (days)').blur();
	await expect(page.getByText('Reminder lead time updated')).toBeVisible();

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
	await categoryDialog.getByLabel('Name').fill('Rent');
	await categoryDialog.getByRole('button', { name: 'Add category' }).click();
	await expect(categoryDialog).not.toBeVisible();

	// Due in 2 days: outside the old 1-day default, inside the new 3-day lead time.
	const twoDaysFromNow = (new Date().getUTCDay() + 2) % 7;
	await page.getByRole('link', { name: 'Recurring', exact: true }).click();
	await page.getByRole('button', { name: 'Add rule' }).click();
	const ruleDialog = page.getByRole('dialog');
	await ruleDialog.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking' }).click();
	await ruleDialog.getByLabel('Category').click();
	await page.getByRole('option', { name: 'Rent' }).click();
	await ruleDialog.getByLabel('Frequency').click();
	await page.getByRole('option', { name: 'Weekly' }).click();
	await ruleDialog.getByLabel('Day').fill(String(twoDaysFromNow));
	await ruleDialog.getByLabel('Amount').fill('1000');
	await ruleDialog.getByRole('button', { name: 'Add rule' }).click();
	await expect(ruleDialog).not.toBeVisible();

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
	await unlock(page, '3034');

	const dispatched = await getDispatchedNotifications(page);
	expect(dispatched).toHaveLength(1);
	expect(dispatched[0].title).toContain('Rent');
});
