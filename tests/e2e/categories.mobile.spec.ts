import { test, expect, type Page } from '@playwright/test';

// The Categories page on a phone profile: it fits the screen, and adding or editing a category opens
// a sheet from the bottom of the screen rather than a floating dialog.

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

const noSideScroll = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('a category is added in a bottom sheet, and the page fits the phone', async ({ page }) => {
	await onboard(page, '552301');
	await page.goto('/categories');
	await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
	await expect(page.getByText('No categories yet')).toBeVisible();

	await page.getByRole('button', { name: 'Add your own' }).click();
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByRole('heading', { name: 'New category' })).toBeVisible();
	// It sits against the bottom edge of the screen.
	const box = await sheet.boundingBox();
	const viewport = page.viewportSize()!;
	expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport.height - 2);
	expect(box!.width).toBeGreaterThanOrEqual(viewport.width - 2);

	await sheet.getByLabel('Name').fill('Groceries');
	await sheet.getByRole('radio', { name: 'Icon Groceries' }).click();
	await sheet.getByRole('button', { name: 'Add category' }).click();
	await expect(sheet).not.toBeVisible();

	await expect(page.getByRole('button', { name: 'Edit Groceries' })).toBeVisible();
	expect(await noSideScroll(page)).toBe(true);

	// The row's actions are big enough to hit with a thumb.
	const edit = await page.getByRole('button', { name: 'Edit Groceries' }).boundingBox();
	expect(edit!.width).toBeGreaterThanOrEqual(40);
	expect(edit!.height).toBeGreaterThanOrEqual(40);
});
