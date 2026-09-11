import { test, expect, type Page } from '@playwright/test';
import { lockAndReload } from './helpers';

// Feature 008 (Share-to-Quick-Add). Covers quickstart.md Scenarios 1-3.
//
// A share_target POST is a top-level NAVIGATION the OS performs, matched by the browser
// against every registered service worker's scope independently of whatever page is
// currently open — a subresource fetch() from the app's own page would NOT be intercepted,
// since no app page is ever loaded within the custom worker's "/share-target" scope
// (research.md §2). So these tests simulate the share the same way the real OS does: by
// submitting a real <form method="POST" enctype="multipart/form-data" action="/share-target">
// navigation, not a fetch() call.

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function addAccount(page: Page, name: string, openingBalance: string) {
	await page.getByRole('link', { name: 'Accounts' }).click();
	await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
	await page.getByRole('button', { name: 'Add account' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByLabel('Opening balance').fill(openingBalance);
	await dialog.getByRole('button', { name: 'Add account' }).click();
	await expect(dialog).not.toBeVisible();
}

/** Generates a real, decodable JPEG entirely in the browser (canvas), same technique as
 * tests/e2e/receiptAttachments.spec.ts — this app has no image-processing dependency
 * (spec 005 research.md §8), so a valid image needs a real browser canvas to produce. */
async function generateJpeg(page: Page): Promise<Buffer> {
	const dataUrl = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 40;
		canvas.height = 40;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#2563eb';
		ctx.fillRect(0, 0, 40, 40);
		return canvas.toDataURL('image/jpeg', 0.9);
	});
	return Buffer.from(dataUrl.split(',')[1], 'base64');
}

/** Waits until the narrow-scope share-target service worker (public/sw-share-target.js) is
 *  active, so a subsequently submitted share is guaranteed to be intercepted rather than
 *  racing the worker's own registration/activation. */
async function waitForShareWorker(page: Page) {
	await page.waitForFunction(async () => {
		const reg = await navigator.serviceWorker.getRegistration('/share-target');
		return !!reg?.active;
	});
}

/** Simulates an OS share by submitting a real POST navigation to the manifest's single
 * share_target action, exactly as a real share sheet selection would. */
async function submitShare(
	page: Page,
	fields: { text?: string; url?: string; title?: string },
	file?: { name: string; mimeType: string; buffer: Buffer }
) {
	await page.evaluate((f: Record<string, string>) => {
		const form = document.createElement('form');
		form.id = 'share-test-form';
		form.method = 'POST';
		form.enctype = 'multipart/form-data';
		form.action = '/share-target';
		form.style.display = 'none';
		for (const [k, v] of Object.entries(f)) {
			const input = document.createElement('input');
			input.type = 'hidden';
			input.name = k;
			input.value = v;
			form.appendChild(input);
		}
		document.body.appendChild(form);
	}, fields);

	if (file) {
		await page.evaluate(() => {
			const form = document.getElementById('share-test-form') as HTMLFormElement;
			const fileInput = document.createElement('input');
			fileInput.type = 'file';
			fileInput.name = 'file';
			fileInput.id = 'share-test-file-input';
			form.appendChild(fileInput);
		});
		await page.locator('#share-test-file-input').setInputFiles(file);
	}

	await page.evaluate(() => {
		const form = document.getElementById('share-test-form') as HTMLFormElement;
		form.submit();
	});
}

test('shares text into a pre-parsed Quick Add screen (Scenario 1, FR-002)', async ({ page }) => {
	await onboard(page, '618127');
	await waitForShareWorker(page);

	await submitShare(page, { text: 'Rs.250.00 debited from A/c XX1234 to Coffee Shop Ref No 999' });

	await expect(page.getByRole('heading', { name: 'Quick Add' })).toBeVisible();
	await expect(page.getByLabel('Paste a payment notification')).toHaveValue(
		'Rs.250.00 debited from A/c XX1234 to Coffee Shop Ref No 999'
	);
	// Already parsed automatically — same as clicking "Parse" manually (FR-002).
	await expect(page.getByText("Couldn't confidently read")).not.toBeVisible();
	await expect(page.getByLabel('Merchant')).toHaveValue('Coffee Shop');
});

test('shared text survives a locked app and appears after unlocking (Scenario 2, FR-005)', async ({
	page
}) => {
	await onboard(page, '618227');
	await waitForShareWorker(page);
	await lockAndReload(page);
	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();

	await submitShare(page, { text: 'Rs.99.00 debited from A/c XX5555 to Metro Card' });

	// The share URL survives underneath the lock screen (research.md §1) — still locked.
	await expect(page.getByRole('heading', { name: 'Enter your PIN' })).toBeVisible();

	await page.getByLabel('PIN').fill('618227');
	await page.getByRole('button', { name: 'Unlock' }).click();

	await expect(page.getByRole('heading', { name: 'Quick Add' })).toBeVisible();
	await expect(page.getByLabel('Paste a payment notification')).toHaveValue(
		'Rs.99.00 debited from A/c XX5555 to Metro Card'
	);
});

test('shares an image into a pre-attached new transaction (Scenario 3, FR-004)', async ({
	page
}) => {
	await onboard(page, '618327');
	await addAccount(page, 'Checking', '1000');
	await waitForShareWorker(page);

	const jpeg = await generateJpeg(page);
	await submitShare(page, {}, { name: 'receipt.jpg', mimeType: 'image/jpeg', buffer: jpeg });

	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await expect(page.getByAltText('Shared photo preview')).toBeVisible();
	await expect(page.getByText('receipt.jpg')).toBeVisible();

	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('45');
	await page.getByRole('button', { name: 'Save transaction' }).click();

	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	await page
		.getByRole('row', { name: /Checking/ })
		.getByRole('button', { name: 'Attachments' })
		.click();
	await expect(page.getByAltText('Receipt attachment')).toBeVisible();
});

test('shared text is not lost when blocked by a second instance (Scenario 6, FR-006)', async ({
	context
}) => {
	const pageA = await context.newPage();
	await onboard(pageA, '618427');

	const pageB = await context.newPage();
	await pageB.goto('/');
	await expect(pageB.getByText('Already open in another tab')).toBeVisible();
	await waitForShareWorker(pageB);

	await submitShare(pageB, { text: 'Rs.15.00 debited from A/c XX9999 to Snacks' });

	// The share URL survives underneath BlockedScreen, exactly as it does under LockScreen
	// (research.md §1) — still blocked, nothing discarded.
	await expect(pageB.getByText('Already open in another tab')).toBeVisible();

	await pageA.close();
	// pageB is promoted to primary, resumes the session pageA already had (spec 009), and
	// then finally mounts the router — matching the still-present share-target-landing URL.
	await expect(pageB.getByRole('heading', { name: 'Quick Add' })).toBeVisible({
		timeout: 10000
	});
	await expect(pageB.getByLabel('Paste a payment notification')).toHaveValue(
		'Rs.15.00 debited from A/c XX9999 to Snacks'
	);
});

test('an unsupported shared file type is declined gracefully, not silently dropped (Scenario 4, FR-007)', async ({
	page
}) => {
	await onboard(page, '618527');
	await addAccount(page, 'Checking', '1000');
	await waitForShareWorker(page);

	// A real OS share sheet only ever offers this app for image/* (the manifest's `files`
	// mapping) — this simulates the defensive case where an unsupported type arrives anyway.
	await submitShare(
		page,
		{},
		{ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') }
	);

	// The app doesn't crash: it still lands on New Transaction with the (unusable) file noted.
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await expect(page.getByText('clip.mp4')).toBeVisible();

	await page.getByLabel('Account').click();
	await page.getByRole('option', { name: 'Checking', exact: true }).click();
	await page.getByLabel('Amount').fill('10');
	await page.getByRole('button', { name: 'Save transaction' }).click();

	// Transaction still saves; only the attachment is declined, with a clear reason —
	// never a silent drop.
	await expect(page.getByText(/shared image couldn't be attached/)).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
});
