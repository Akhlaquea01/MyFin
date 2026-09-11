import { test, expect, type Page } from '@playwright/test';

// Feature 003 (Savings Goals), User Stories 1-3, plus Scenario 6 (delete/restore).
// Dates are computed relative to "today" at test-run time so the test never goes stale.

function isoDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}
function monthsAgo(n: number): string {
	const d = new Date();
	d.setUTCMonth(d.getUTCMonth() - n);
	return isoDate(d);
}
function monthsFromNow(n: number): string {
	const d = new Date();
	d.setUTCMonth(d.getUTCMonth() + n);
	return isoDate(d);
}
const TODAY = isoDate(new Date());

async function createGoal(page: Page, name: string, targetAmount: string, targetDate?: string) {
	await page.getByRole('button', { name: 'Add goal' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Target amount').fill(targetAmount);
	if (targetDate) {
		await dialog.getByLabel('Target date (optional)').fill(targetDate);
	}
	await dialog.getByRole('button', { name: 'Add goal' }).click();
	await expect(dialog).not.toBeVisible();
}

async function logContribution(page: Page, goalName: string, amount: string, date: string) {
	const card = page.locator('[data-slot="card"]').filter({ hasText: goalName });
	await card.getByRole('button', { name: 'Add contribution' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Amount').fill(amount);
	await dialog.getByLabel('Date').fill(date);
	await dialog.getByRole('button', { name: 'Log contribution' }).click();
	await expect(dialog).not.toBeVisible();
}

test('create a goal, log contributions, and reach it (Scenario 1)', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('202084');
	await page.getByLabel('Confirm PIN').fill('202084');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Savings Goals' }).click();
	await expect(page.getByRole('heading', { name: 'Savings Goals' })).toBeVisible();

	await createGoal(page, 'Emergency Fund', '10000');
	const goalCard = page.locator('[data-slot="card"]').filter({ hasText: 'Emergency Fund' });
	await expect(goalCard.getByText('(0%)')).toBeVisible();

	await logContribution(page, 'Emergency Fund', '3000', TODAY);
	await logContribution(page, 'Emergency Fund', '2000', TODAY);
	await expect(goalCard.getByText('(50%)')).toBeVisible();

	await logContribution(page, 'Emergency Fund', '6000', TODAY);
	await expect(goalCard.getByText('(110%)')).toBeVisible();
	await expect(goalCard.getByText('Achieved')).toBeVisible();
});

test('projected completion date and behind-schedule flag (Scenario 2)', async ({ page }) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('202184');
	await page.getByLabel('Confirm PIN').fill('202184');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Savings Goals' }).click();
	await createGoal(page, 'Vacation', '12000', monthsFromNow(3));

	await logContribution(page, 'Vacation', '1000', monthsAgo(2));
	await logContribution(page, 'Vacation', '1000', TODAY);

	const goalCard = page.locator('[data-slot="card"]').filter({ hasText: 'Vacation' });
	await expect(goalCard.getByText('Behind schedule')).toBeVisible();

	await logContribution(page, 'Vacation', '4000', TODAY);
	await expect(goalCard.getByText('On track')).toBeVisible();
});

test('goals overview shows mixed statuses and a correct total (Scenario 3), and delete/restore keeps contributions (Scenario 6)', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('202284');
	await page.getByLabel('Confirm PIN').fill('202284');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await page.getByRole('link', { name: 'Savings Goals' }).click();

	// Emergency Fund -> achieved (₹11,000 saved).
	await createGoal(page, 'Emergency Fund', '10000');
	await logContribution(page, 'Emergency Fund', '11000', TODAY);

	// Vacation -> on-track (₹6,000 saved over a 2-month span, well ahead of its 3-month target).
	await createGoal(page, 'Vacation', '12000', monthsFromNow(3));
	await logContribution(page, 'Vacation', '1000', monthsAgo(2));
	await logContribution(page, 'Vacation', '5000', TODAY);

	// New Laptop -> insufficient-data (only one contribution).
	await createGoal(page, 'New Laptop', '8000', undefined);
	await logContribution(page, 'New Laptop', '500', TODAY);

	await expect(page.getByText('Total saved across goals')).toBeVisible();
	await expect(page.getByText('17,500.00')).toBeVisible();

	const laptopCard = page.locator('[data-slot="card"]').filter({ hasText: 'New Laptop' });
	await expect(laptopCard.getByText('Log more contributions to see a projection.')).toBeVisible();

	// Scenario 6: delete New Laptop, confirm it's gone, restore it, confirm it's back with its contribution.
	await laptopCard.getByRole('button', { name: 'Delete goal' }).click();
	await expect(page.locator('[data-slot="card"]').filter({ hasText: 'New Laptop' })).toHaveCount(0);
	await expect(page.getByText('17,000.00')).toBeVisible(); // total drops by the removed goal's 500

	await page.getByRole('link', { name: 'Trash' }).click();
	const trashRow = page.locator('div.rounded-lg.border', { hasText: 'New Laptop' });
	await trashRow.getByRole('button', { name: 'Restore' }).click();

	await page.getByRole('link', { name: 'Savings Goals' }).click();
	const restoredCard = page.locator('[data-slot="card"]').filter({ hasText: 'New Laptop' });
	await expect(restoredCard).toBeVisible();
	await expect(restoredCard.getByText('500.00', { exact: true })).toBeVisible();
});
