import { test, expect, type Page } from '@playwright/test';
import { lockAndReload } from './helpers';

// The Alerts list: a due reminder is kept in the app even when the system will not show it, carries
// an unread badge, opens the matching screen, and can be cleared.

async function denyNotifications(page: Page) {
	await page.addInitScript(() => {
		class FakeNotification {
			static permission = 'denied';
			static requestPermission() {
				return Promise.resolve('denied');
			}
		}
		// @ts-expect-error -- replacing the global for a deterministic permission state
		window.Notification = FakeNotification;
	});
}

function tomorrowWeekday(): number {
	return (new Date().getDay() + 1) % 7;
}

test('a due bill is listed under Alerts with a badge, opens its screen, and can be cleared', async ({
	page
}) => {
	await denyNotifications(page);
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('318274');
	await page.getByLabel('Confirm PIN').fill('318274');
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

	// Unlocking runs the reminder check.
	await lockAndReload(page);
	await page.getByLabel('PIN').fill('318274');
	await page.getByRole('button', { name: 'Unlock' }).click();
	await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();

	// The nav entry carries the unread count.
	const alertsLink = page.getByRole('link', { name: /^Alerts/ });
	await expect(alertsLink).toContainText('1');

	await alertsLink.click();
	await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
	await expect(page.getByText('Upcoming: Rent')).toBeVisible();
	await expect(page.getByText('New', { exact: true })).toBeVisible();

	// Opening it goes to the bill, and marks it read.
	await page
		.getByRole('button', { name: /Upcoming: Rent/ })
		.first()
		.click();
	await expect(page.getByRole('heading', { name: /Upcoming/ })).toBeVisible();
	await expect(page.getByRole('link', { name: /^Alerts/ })).not.toContainText('1');

	// Clearing asks first, in the app's own dialog.
	await page.getByRole('link', { name: /^Alerts/ }).click();
	await page.getByRole('button', { name: 'Clear all' }).click();
	const confirm = page.getByRole('alertdialog');
	await expect(confirm).toContainText('Clear every alert?');
	await confirm.locator('[data-slot="alert-dialog-action"]').click();
	await expect(page.getByText('No alerts.')).toBeVisible();
});
