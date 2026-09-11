import { test, expect, type Page } from '@playwright/test';

// Feature 005 (Receipt & Photo Attachments). Covers quickstart.md Scenarios 1, 2, 4, 5, 6.
// Scenario 3 (compression bound) is folded into the Scenario 1 test since it needs the same
// attach step; Scenario 7 (backup/restore) is already covered by tests/unit/backupService.test.ts.

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

async function addTransaction(page: Page, accountName: string, amount: string, notes: string) {
	await page.getByRole('link', { name: 'New transaction' }).click();
	await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible();
	await chooseOption(page, 'Account', accountName);
	await page.getByLabel('Amount').fill(amount);
	await page.getByLabel('Notes').fill(notes);
	await page.getByRole('button', { name: 'Save transaction' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
}

function attachmentsDialogFor(page: Page, notes: string) {
	return {
		open: async () => {
			await page
				.getByRole('row', { name: new RegExp(notes) })
				.getByRole('button', { name: 'Attachments' })
				.click();
			return page.getByRole('dialog').filter({ hasText: 'Attachments' });
		}
	};
}

/**
 * Generates a real, decodable JPEG entirely in the browser (canvas) so the app's real
 * compressImage() path — createImageBitmap + canvas downscale + re-encode — has valid image
 * bytes to work with. A pure Node-side fixture couldn't produce a real decodable JPEG without
 * an image library, which this project deliberately has none of (research.md §8).
 *
 * `large: true` renders a high-resolution (3000x2000) gradient-plus-shapes image — big enough
 * to force real downscaling — for the Scenario 3 compression-bound check; otherwise a tiny,
 * fast-to-generate placeholder is used, since the other scenarios only care that a valid
 * attachment was stored, not its dimensions.
 */
async function generateJpeg(page: Page, large = false): Promise<Buffer> {
	const dataUrl = await page.evaluate((big: boolean) => {
		const size = big ? { w: 3000, h: 2000 } : { w: 40, h: 40 };
		const canvas = document.createElement('canvas');
		canvas.width = size.w;
		canvas.height = size.h;
		const ctx = canvas.getContext('2d')!;
		const gradient = ctx.createLinearGradient(0, 0, size.w, size.h);
		gradient.addColorStop(0, '#2563eb');
		gradient.addColorStop(1, '#f97316');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, size.w, size.h);
		if (big) {
			for (let i = 0; i < 400; i++) {
				ctx.fillStyle = `rgba(${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, ${Math.floor(Math.random() * 255)}, 0.6)`;
				ctx.beginPath();
				ctx.arc(
					Math.random() * size.w,
					Math.random() * size.h,
					10 + Math.random() * 60,
					0,
					Math.PI * 2
				);
				ctx.fill();
			}
		}
		return canvas.toDataURL('image/jpeg', 0.95);
	}, large);
	const base64 = dataUrl.split(',')[1];
	return Buffer.from(base64, 'base64');
}

function base64ByteLength(base64: string): number {
	return Buffer.from(base64, 'base64').length;
}

test('attach, view, and remove a receipt; rejects unsupported/oversized files; compresses large photos (Scenarios 1, 2, 3)', async ({
	page
}) => {
	await onboard(page, '500184');

	await goTo(page, 'Accounts', 'Accounts');
	await addAccount(page, 'Checking', '1000');

	await goTo(page, 'Transactions', 'Transactions');
	await addTransaction(page, 'Checking', '75', 'Groceries');

	const dialogHelper = attachmentsDialogFor(page, 'Groceries');
	let dialog = await dialogHelper.open();
	await expect(dialog.getByText('No attachments yet.')).toBeVisible();

	// Scenario 2: unsupported file type is rejected, nothing stored.
	await dialog.locator('input[type="file"]').setInputFiles({
		name: 'receipt.pdf',
		mimeType: 'application/pdf',
		buffer: Buffer.from('not an image')
	});
	await expect(page.getByText('Only JPEG, PNG, or WebP images are supported.')).toBeVisible();
	await expect(dialog.getByText('No attachments yet.')).toBeVisible();

	// Scenario 2: oversized file (> 20MB) is rejected, nothing stored.
	await dialog.locator('input[type="file"]').setInputFiles({
		name: 'huge.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.alloc(21 * 1024 * 1024)
	});
	await expect(page.getByText('That file is too large (max 20MB).')).toBeVisible();
	await expect(dialog.getByText('No attachments yet.')).toBeVisible();

	// Scenario 1 + 3: a real, large photo is accepted, compressed, and shown as a thumbnail.
	const largeJpeg = await generateJpeg(page, true);
	await dialog.locator('input[type="file"]').setInputFiles({
		name: 'photo.jpg',
		mimeType: 'image/jpeg',
		buffer: largeJpeg
	});
	const thumbnail = dialog.getByAltText('Receipt attachment');
	await expect(thumbnail).toBeVisible();

	const storedSrc = await thumbnail.getAttribute('src');
	const storedBase64 = storedSrc!.split(',')[1];
	expect(base64ByteLength(storedBase64)).toBeLessThan(500 * 1024);

	// Row indicator now shows a count of 1.
	const attachmentsButton = page
		.getByRole('row', { name: /Groceries/ })
		.getByRole('button', { name: 'Attachments' });
	await page.keyboard.press('Escape');
	await expect(attachmentsButton).toContainText('1');

	// Full-size view opens on click.
	dialog = await dialogHelper.open();
	await dialog.getByAltText('Receipt attachment').click();
	const fullSizeDialog = page.getByRole('dialog').filter({ hasText: 'Receipt' });
	await expect(fullSizeDialog.getByAltText('Receipt attachment full size')).toBeVisible();
	await page.keyboard.press('Escape');

	// Escape closes both the nested full-size view and the Attachments dialog behind it, so
	// reopen before continuing.
	dialog = await dialogHelper.open();

	// Remove clears the thumbnail and the row indicator.
	await dialog.getByRole('button', { name: 'Remove attachment' }).click();
	await expect(dialog.getByText('No attachments yet.')).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(attachmentsButton).not.toContainText('1');
});

test('soft-delete/restore keeps attachments, and up to 5 independent attachments are supported (Scenarios 4, 5)', async ({
	page
}) => {
	await onboard(page, '500284');

	await goTo(page, 'Accounts', 'Accounts');
	await addAccount(page, 'Checking', '1000');

	await goTo(page, 'Transactions', 'Transactions');
	await addTransaction(page, 'Checking', '40', 'Pharmacy');

	const dialogHelper = attachmentsDialogFor(page, 'Pharmacy');
	let dialog = await dialogHelper.open();
	await dialog.locator('input[type="file"]').setInputFiles({
		name: 'a.jpg',
		mimeType: 'image/jpeg',
		buffer: await generateJpeg(page)
	});
	await expect(dialog.getByAltText('Receipt attachment')).toHaveCount(1);
	await page.keyboard.press('Escape');

	// Scenario 4: soft-delete then restore keeps the attachment.
	await page
		.getByRole('row', { name: /Pharmacy/ })
		.getByRole('button', { name: 'Delete' })
		.click();
	await expect(page.getByText('No transactions match.')).toBeVisible();

	await goTo(page, 'Trash', 'Trash');
	await page
		.locator('div.rounded-lg.border', { hasText: 'Pharmacy' })
		.getByRole('button', { name: 'Restore' })
		.click();

	await goTo(page, 'Transactions', 'Transactions');
	dialog = await dialogHelper.open();
	await expect(dialog.getByAltText('Receipt attachment')).toHaveCount(1);

	// Scenario 5: add four more (five total), each independently viewable/removable.
	for (let i = 0; i < 4; i++) {
		await dialog.locator('input[type="file"]').setInputFiles({
			name: `extra-${i}.jpg`,
			mimeType: 'image/jpeg',
			buffer: await generateJpeg(page)
		});
		await expect(dialog.getByAltText('Receipt attachment')).toHaveCount(i + 2);
	}
	await expect(dialog.getByAltText('Receipt attachment')).toHaveCount(5);

	// The "Add attachment" control is disabled once the 5-attachment cap is hit — the UI's
	// enforcement of the same cap the repository throws on (research.md §7).
	await expect(dialog.getByRole('button', { name: 'Add attachment' })).toBeDisabled();

	// Removing one leaves the other four intact.
	await dialog.getByRole('button', { name: 'Remove attachment' }).first().click();
	await expect(dialog.getByAltText('Receipt attachment')).toHaveCount(4);
	await expect(dialog.getByRole('button', { name: 'Add attachment' })).toBeEnabled();
});

test('permanent purge from Trash removes the transaction and its attachments entirely (Scenario 6)', async ({
	page
}) => {
	await onboard(page, '500384');

	await goTo(page, 'Accounts', 'Accounts');
	await addAccount(page, 'Checking', '1000');

	await goTo(page, 'Transactions', 'Transactions');
	await addTransaction(page, 'Checking', '20', 'Coffee');

	const dialogHelper = attachmentsDialogFor(page, 'Coffee');
	const dialog = await dialogHelper.open();
	await dialog.locator('input[type="file"]').setInputFiles({
		name: 'receipt.jpg',
		mimeType: 'image/jpeg',
		buffer: await generateJpeg(page)
	});
	await expect(dialog.getByAltText('Receipt attachment')).toHaveCount(1);
	await page.keyboard.press('Escape');

	await page
		.getByRole('row', { name: /Coffee/ })
		.getByRole('button', { name: 'Delete' })
		.click();
	await expect(page.getByText('No transactions match.')).toBeVisible();

	await goTo(page, 'Trash', 'Trash');
	await expect(page.getByText('Coffee')).toBeVisible();

	page.once('dialog', (d) => void d.accept());
	await page
		.locator('div.rounded-lg.border', { hasText: 'Coffee' })
		.getByRole('button', { name: 'Delete forever' })
		.click();

	// Gone from Trash entirely (not just hidden) — the underlying cascade delete of
	// transactionSplits/transactionTags/attachments is covered by
	// tests/integration/attachmentRepository.test.ts's purge test.
	await expect(page.getByText('Coffee')).not.toBeVisible();
	await expect(page.getByText('Transaction permanently deleted')).toBeVisible();
});
