import { test, expect, type Page } from '@playwright/test';
import { lockAndReload } from './helpers';

// Feature 010 (Personal Lending & Borrowing), User Stories 1-5.

// Same fake-Notification technique as recurringBudgetNotifications.spec.ts (spec 004):
// Playwright cannot observe a real OS notification, so an init script records every
// dispatched notification into window.__notifications instead of showing one.
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

async function unlockAfterReload(page: Page, pin: string) {
	await page.getByLabel('PIN').fill(pin);
	await page.getByRole('button', { name: 'Unlock' }).click();
	await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
	// runNotificationCheck() is fire-and-forget from handleUnlock; give its awaits a beat.
	await page.waitForTimeout(500);
}

async function setUpAccount(page: Page, name: string, openingBalance: string) {
	await page.getByRole('link', { name: 'Accounts' }).click();
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Opening balance').fill(openingBalance);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

/** Normalized (comma-stripped) so the assertion doesn't depend on locale-specific grouping. */
async function accountBalanceText(page: Page, name: string): Promise<string> {
	await page.getByRole('link', { name: 'Accounts' }).click();
	const card = page.locator('[data-slot="card"]').filter({ hasText: name });
	return (await card.innerText()).replace(/,/g, '').trim();
}

async function recordLoan(
	page: Page,
	opts: {
		person: string;
		direction: 'I lent them money' | 'I borrowed money from them';
		amount: string;
		account: string;
		dueDate?: string;
	}
) {
	await page.getByRole('link', { name: 'People' }).click();
	await page.getByRole('button', { name: 'Record a loan' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Person').fill(opts.person);
	await dialog.getByLabel('Direction').click();
	await page.getByRole('option', { name: opts.direction }).click();
	await dialog.getByLabel('Amount').fill(opts.amount);
	await dialog.getByLabel('Account').click();
	await page.getByRole('option', { name: opts.account, exact: true }).click();
	if (opts.dueDate) {
		await dialog.getByLabel('Due date (optional)').fill(opts.dueDate);
	}
	await dialog.getByRole('button', { name: 'Record loan' }).click();
	await expect(dialog).not.toBeVisible();
}

test('record a lent and a borrowed loan; account balances move accordingly (Scenario 1)', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('482913');
	await page.getByLabel('Confirm PIN').fill('482913');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await setUpAccount(page, 'Cash', '5000');

	await recordLoan(page, {
		person: 'Asha',
		direction: 'I lent them money',
		amount: '1000',
		account: 'Cash'
	});
	let balanceText = await accountBalanceText(page, 'Cash');
	expect(balanceText).toContain('4000.00');

	await recordLoan(page, {
		person: 'Rohit',
		direction: 'I borrowed money from them',
		amount: '500',
		account: 'Cash'
	});
	balanceText = await accountBalanceText(page, 'Cash');
	expect(balanceText).toContain('4500.00');

	await page.getByRole('link', { name: 'People' }).click();
	await expect(page.getByText('Asha')).toBeVisible();
	await expect(page.getByText('Rohit')).toBeVisible();
});

test('partial repayments pay down a loan to settled; overpayment and post-settlement repayment are rejected (Scenario 2)', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('317420');
	await page.getByLabel('Confirm PIN').fill('317420');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await setUpAccount(page, 'Cash', '5000');
	await recordLoan(page, {
		person: 'Asha',
		direction: 'I lent them money',
		amount: '1000',
		account: 'Cash'
	});

	await page.getByRole('link', { name: 'People' }).click();
	const ashaCard = page.locator('[data-slot="card"]').filter({ hasText: 'Asha' });
	await expect(ashaCard.locator('[data-slot="card-content"] span.font-mono')).toHaveText(
		'1,000.00'
	);

	async function logRepayment(amount: string) {
		await ashaCard.getByRole('button', { name: 'Log repayment' }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Amount').fill(amount);
		await dialog.getByRole('button', { name: 'Log repayment' }).click();
	}

	// Partial repayment: 1000 -> 600 remaining.
	await logRepayment('400');
	await expect(page.getByRole('dialog')).not.toBeVisible();
	await expect(ashaCard.locator('[data-slot="card-content"] span.font-mono')).toHaveText('600.00');
	const balanceText = await accountBalanceText(page, 'Cash');
	expect(balanceText).toContain('4400.00');

	await page.getByRole('link', { name: 'People' }).click();

	// Overpayment (700 > 600 remaining) is rejected — dialog stays open, nothing changes.
	await logRepayment('700');
	await expect(page.getByRole('dialog')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(ashaCard.locator('[data-slot="card-content"] span.font-mono')).toHaveText('600.00');

	// Exact remaining amount settles the loan.
	await logRepayment('600');
	await expect(page.getByRole('dialog')).not.toBeVisible();
	await expect(ashaCard.getByText('Settled')).toBeVisible();
	await expect(ashaCard.getByRole('button', { name: 'Log repayment' })).toHaveCount(0);
});

test('People list shows net position and flags an overdue balance; Dashboard tile totals match (Scenario 3)', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('905162');
	await page.getByLabel('Confirm PIN').fill('905162');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await setUpAccount(page, 'Cash', '5000');

	// Asha: settled loan (fully repaid) -> excluded from outstanding totals.
	await recordLoan(page, {
		person: 'Asha',
		direction: 'I lent them money',
		amount: '200',
		account: 'Cash'
	});
	await page.getByRole('link', { name: 'People' }).click();
	const ashaCard = page.locator('[data-slot="card"]').filter({ hasText: 'Asha' });
	await ashaCard.getByRole('button', { name: 'Log repayment' }).click();
	await page.getByRole('dialog').getByLabel('Amount').fill('200');
	await page.getByRole('dialog').getByRole('button', { name: 'Log repayment' }).click();
	await expect(page.getByRole('dialog')).not.toBeVisible();

	// Rohit: open borrowed loan -> "you owe".
	await recordLoan(page, {
		person: 'Rohit',
		direction: 'I borrowed money from them',
		amount: '500',
		account: 'Cash'
	});

	// Meera: open lent loan, due yesterday -> overdue, "owed to you".
	const yesterday = new Date();
	yesterday.setUTCDate(yesterday.getUTCDate() - 1);
	await recordLoan(page, {
		person: 'Meera',
		direction: 'I lent them money',
		amount: '300',
		account: 'Cash',
		dueDate: yesterday.toISOString().slice(0, 10)
	});

	await page.getByRole('link', { name: 'People' }).click();
	const meeraCard = page.locator('[data-slot="card"]').filter({ hasText: 'Meera' });
	await expect(meeraCard.getByText('Overdue', { exact: true })).toBeVisible();
	await expect(meeraCard.getByText('Owed to you: 300.00')).toBeVisible();

	const rohitCard = page.locator('[data-slot="card"]').filter({ hasText: 'Rohit' });
	await expect(rohitCard.getByText('You owe: 500.00')).toBeVisible();
	await expect(rohitCard.getByText('Overdue', { exact: true })).toHaveCount(0);

	await expect(ashaCard.getByText('Overdue', { exact: true })).toHaveCount(0);
	await expect(ashaCard.getByText(/Owed to you|You owe/)).toHaveCount(0);

	await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
	const lendingTile = page.locator('[data-slot="card"]').filter({ hasText: 'Lending' });
	await expect(lendingTile.getByText("You're owed")).toBeVisible();
	await expect(lendingTile).toContainText('300.00');
	await expect(lendingTile).toContainText('500.00');
});

test('an overdue loan reminds once, stays silent on repeat, and stops once settled (Scenario 4)', async ({
	page
}) => {
	const pin = '618204';
	await installFakeNotification(page, 'granted');
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await setUpAccount(page, 'Cash', '5000');
	const yesterday = new Date();
	yesterday.setUTCDate(yesterday.getUTCDate() - 1);
	await recordLoan(page, {
		person: 'Meera',
		direction: 'I lent them money',
		amount: '300',
		account: 'Cash',
		dueDate: yesterday.toISOString().slice(0, 10)
	});

	// First unlock after the overdue loan exists: the reminder should fire.
	await lockAndReload(page);
	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
	await unlockAfterReload(page, pin);
	const firstCheck = await getDispatchedNotifications(page);
	expect(firstCheck).toHaveLength(1);
	expect(firstCheck[0].title).toContain('Meera');

	// Second unlock, same overdue state: must not notify again.
	await lockAndReload(page);
	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
	await unlockAfterReload(page, pin);
	const secondCheck = await getDispatchedNotifications(page);
	expect(secondCheck).toHaveLength(0);

	// Settle the loan in full, then unlock again: still no further reminder.
	const meeraCard = page.locator('[data-slot="card"]').filter({ hasText: 'Meera' });
	await meeraCard.getByRole('button', { name: 'Log repayment' }).click();
	await page.getByRole('dialog').getByLabel('Amount').fill('300');
	await page.getByRole('dialog').getByRole('button', { name: 'Log repayment' }).click();
	await expect(page.getByRole('dialog')).not.toBeVisible();

	await lockAndReload(page);
	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();
	await unlockAfterReload(page, pin);
	const thirdCheck = await getDispatchedNotifications(page);
	expect(thirdCheck).toHaveLength(0);
});

test('writing off a loan does not change the account balance and excludes it from totals (Scenario 5)', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('740361');
	await page.getByLabel('Confirm PIN').fill('740361');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await setUpAccount(page, 'Cash', '5000');
	await recordLoan(page, {
		person: 'Rohit',
		direction: 'I lent them money',
		amount: '200',
		account: 'Cash'
	});
	const balanceBefore = await accountBalanceText(page, 'Cash');

	await page.getByRole('link', { name: 'People' }).click();
	const rohitCard = page.locator('[data-slot="card"]').filter({ hasText: 'Rohit' });
	await rohitCard.getByRole('button', { name: 'Write off' }).click();
	await expect(rohitCard.getByText('Written off')).toBeVisible();
	await expect(rohitCard.getByText(/Owed to you|You owe/)).toHaveCount(0);

	const balanceAfter = await accountBalanceText(page, 'Cash');
	expect(balanceAfter).toBe(balanceBefore);

	await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
	const lendingTile = page.locator('[data-slot="card"]').filter({ hasText: 'Lending' });
	await expect(lendingTile).toContainText('0.00');
});

test('deleting a person with an open loan is blocked, and undoing a repayment restores balances (Scenarios 6-7)', async ({
	page
}) => {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill('529480');
	await page.getByLabel('Confirm PIN').fill('529480');
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	await setUpAccount(page, 'Cash', '5000');
	await recordLoan(page, {
		person: 'Rohit',
		direction: 'I borrowed money from them',
		amount: '500',
		account: 'Cash'
	});

	// Scenario 6: deleting a person with an open loan is blocked.
	await page.getByRole('link', { name: 'People' }).click();
	const rohitCard = page.locator('[data-slot="card"]').filter({ hasText: 'Rohit' });
	await rohitCard.getByRole('button', { name: 'Delete person' }).click();
	await expect(page.getByText(/open loan/i)).toBeVisible();
	await expect(rohitCard).toBeVisible();

	// Settle the loan, then deletion succeeds.
	await rohitCard.getByRole('button', { name: 'Log repayment' }).click();
	await page.getByRole('dialog').getByLabel('Amount').fill('500');
	await page.getByRole('dialog').getByRole('button', { name: 'Log repayment' }).click();
	await expect(page.getByRole('dialog')).not.toBeVisible();

	// Scenario 7: log a repayment on a second, still-open loan, then undo it.
	await recordLoan(page, {
		person: 'Divya',
		direction: 'I lent them money',
		amount: '1000',
		account: 'Cash'
	});
	const balanceAfterLoan = await accountBalanceText(page, 'Cash');

	await page.getByRole('link', { name: 'People' }).click();
	const divyaCard = page.locator('[data-slot="card"]').filter({ hasText: 'Divya' });
	await divyaCard.getByRole('button', { name: 'Log repayment' }).click();
	await page.getByRole('dialog').getByLabel('Amount').fill('100');
	await page.getByRole('dialog').getByRole('button', { name: 'Log repayment' }).click();
	await expect(page.getByRole('dialog')).not.toBeVisible();
	const balanceAfterRepayment = await accountBalanceText(page, 'Cash');
	expect(balanceAfterRepayment).not.toBe(balanceAfterLoan);
	await page.getByRole('link', { name: 'People' }).click();
	await expect(divyaCard.locator('[data-slot="card-content"] span.font-mono')).toHaveText('900.00');

	// Undo the mistaken repayment: balance and pending balance both revert.
	await divyaCard.getByRole('button', { name: 'Undo' }).click();
	const balanceAfterUndo = await accountBalanceText(page, 'Cash');
	expect(balanceAfterUndo).toBe(balanceAfterLoan);
	await page.getByRole('link', { name: 'People' }).click();
	await expect(divyaCard.locator('[data-slot="card-content"] span.font-mono')).toHaveText(
		'1,000.00'
	);

	// The undone repayment shows up in Trash and can be restored.
	await page.getByRole('link', { name: 'Trash' }).click();
	const repaymentsSection = page
		.locator('section')
		.filter({ has: page.getByRole('heading', { name: 'Loan Repayments' }) });
	await expect(repaymentsSection.getByText('100.00')).toBeVisible();
	await repaymentsSection.getByRole('button', { name: 'Restore' }).click();
	await expect(repaymentsSection.getByText('100.00')).toHaveCount(0);

	await page.getByRole('link', { name: 'People' }).click();
	await expect(divyaCard.locator('[data-slot="card-content"] span.font-mono')).toHaveText('900.00');
});
