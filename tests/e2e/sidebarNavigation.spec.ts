import { test, expect } from '@playwright/test';
import { openScreen } from './helpers';

// The sidebar's last group folds nine links down to three entries: Data (Import, Export, Backup),
// Automation (Auto-Categorize, Notifications) and Settings (Security, About). Each entry opens its
// first screen, and a strip along the top of the page reaches the others.

test('the Manage group lists three entries, each reaching its screens through a tab strip', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('518203');
	await page.getByLabel('Confirm PIN').fill('518203');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	// The sidebar names the groups, not the screens inside them.
	for (const entry of ['Data', 'Automation', 'Settings', 'Categories']) {
		await expect(page.getByRole('link', { name: entry, exact: true })).toBeVisible();
	}
	for (const screen of ['Import', 'Export', 'Backup', 'Notifications', 'Security', 'About']) {
		await expect(page.getByRole('link', { name: screen, exact: true })).toHaveCount(0);
	}

	// Data opens Import; its strip lists the rest and marks the open one.
	await page.getByRole('link', { name: 'Data', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Import Transactions' })).toBeVisible();
	const dataStrip = page.getByRole('navigation', { name: 'Data screens' });
	await expect(dataStrip.getByRole('link')).toHaveText([
		'Import',
		'Bulk import',
		'Export',
		'Backup'
	]);
	await expect(dataStrip.getByRole('link', { name: 'Import', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(page.getByRole('link', { name: 'Data', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);

	await dataStrip.getByRole('link', { name: 'Backup' }).click();
	await expect(page.getByRole('heading', { name: 'Backup & Restore' })).toBeVisible();
	// Still inside Data: the entry stays highlighted while its other screens are open.
	await expect(page.getByRole('link', { name: 'Data', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);

	await openScreen(page, 'Automation', 'Notifications');
	await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Data', exact: true })).not.toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(page.getByRole('link', { name: 'Automation', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);

	await openScreen(page, 'Settings', 'About');
	await expect(page.getByRole('heading', { name: 'About' })).toBeVisible();
	await page
		.getByRole('navigation', { name: 'Settings screens' })
		.getByRole('link', { name: 'Security' })
		.click();
	await expect(page).toHaveURL(/\/security$/);

	// A screen outside the folded groups carries no strip on a desktop screen.
	await page.getByRole('link', { name: 'Categories', exact: true }).click();
	await expect(page).toHaveURL(/\/categories$/);
	await expect(page.getByRole('navigation', { name: /screens$/ })).toHaveCount(0);
});
