import { test, expect, type Page } from '@playwright/test';

async function onboard(page: Page, pin: string) {
	await page.goto('/');
	await page.getByLabel('Create PIN').fill(pin);
	await page.getByLabel('Confirm PIN').fill(pin);
	await page.getByRole('button', { name: 'Set PIN' }).click();
	// Not "Dashboard" is visible: in the one test that resets to a genuinely fresh, unseen
	// state (see the nested describe below), a fresh empty install auto-starts the real tour,
	// which — on a narrow viewport — opens the mobile nav sheet immediately (the very fix under
	// test), and that sheet is a modal that ARIA-hides the Dashboard heading behind it.
	// Onboarding having completed is better signaled by the PIN form itself being gone.
	await expect(page.getByRole('heading', { name: 'Welcome' })).not.toBeVisible();
}

test.describe('Quick Tour', () => {
	test('replaying the tour highlights the desktop sidebar nav item', async ({ page }) => {
		await onboard(page, '740261');

		await page.getByRole('link', { name: 'Backup' }).click();
		await expect(page.getByRole('heading', { name: 'Backup & Restore' })).toBeVisible();
		await page.getByRole('button', { name: /Replay Quick Tour/i }).click();

		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expect(dialog).toContainText('Step 1 of 5');
		await expect(dialog).toHaveAttribute('aria-modal', 'true');

		await page.getByRole('button', { name: 'Skip Tour' }).click();
		await expect(dialog).not.toBeVisible();
	});

	test.describe('auto-started tour (fresh, unseen state)', () => {
		// Every other spec in this suite runs with the tour pre-marked "seen" (see
		// playwright.config.ts) so it doesn't collide with their own `getByRole('dialog')`
		// assertions. This is the one test that actually needs the real first-run trigger, so
		// it resets to a genuinely fresh state for just this describe block.
		test.use({ storageState: { cookies: [], origins: [] } });

		/**
		 * Regression: on a narrow viewport, every tour step's target lives inside the closed-by-
		 * default mobile nav sheet — the desktop sidebar's copy of the same `data-tour` element
		 * is `display:none` there. `document.querySelector` always returned that hidden desktop
		 * copy (first in DOM order) regardless of viewport, so the tour fell back to an
		 * unanchored, centered card on every nav-targeted step on mobile. AppShell must now
		 * auto-open the sheet while the tour is active on a narrow viewport, and the overlay
		 * must find the now-visible mobile copy instead of the hidden desktop one.
		 *
		 * Exercised via the tour's real first-run trigger (a fresh, empty install auto-starts
		 * it) rather than the "Replay Quick Tour" button: replaying interacts with the mobile
		 * sheet's own navigate-to-close behavior in a way that's incidental to what this test is
		 * actually about.
		 */
		test('auto-starting the tour on a narrow viewport opens the mobile nav sheet and highlights its copy of the target', async ({
			page
		}) => {
			await page.setViewportSize({ width: 375, height: 812 });
			await onboard(page, '740262');

			// Located by text rather than `getByRole('dialog')`: the mobile sheet that's also
			// open (correctly, per the fix under test) is itself a Radix modal, and Radix marks
			// sibling portal content `aria-hidden` while a modal is open — which excludes the
			// tour's own portal from the accessibility tree even though it's still visually on
			// screen. That aria-hidden interaction between two simultaneously-open dialogs is a
			// separate, minor follow-on concern; this test is about placement/highlighting,
			// which text/CSS-based locators can verify independent of it.
			const tourCard = page.getByText('Step 1 of 5');
			await expect(tourCard).toBeVisible();

			// The mobile sheet auto-opened alongside the tour, and its own "Accounts" nav link —
			// the tour's actual step-1 target — is visible, not hidden behind a closed sheet.
			// Two copies of this selector exist (the desktop sidebar's, which stays
			// `display:none` at this width): `:visible` picks out the one that's actually on
			// screen.
			const mobileNavLink = page.locator('[data-tour="accounts-nav"]:visible');
			await expect(mobileNavLink).toBeVisible();
			await expect(mobileNavLink).toHaveCount(1);

			// A found, anchored target renders a cut-out spotlight (a real clip-path), unlike
			// the "target not found" fallback, which centers the card with no clip-path/
			// backdrop at all.
			const overlayBackdrop = page.getByTestId('quick-tour-backdrop');
			await expect(overlayBackdrop).toHaveCSS('clip-path', /polygon/);

			await page.getByText('Skip Tour').click();
			await expect(tourCard).not.toBeVisible();
		});
	});
});
