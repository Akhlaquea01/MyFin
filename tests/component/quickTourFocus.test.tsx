import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { QuickTourProvider, APP_QUICK_TOUR_SEEN } from '../../src/components/ui/quick-tour/QuickTourProvider';
import { QuickTourOverlay } from '../../src/components/ui/quick-tour/QuickTourOverlay';
import { QUICK_TOUR_STEPS } from '../../src/components/ui/quick-tour/tour-steps';
import { useQuickTour } from '../../src/hooks/useQuickTour';
import { db } from '../../src/data/dexie/db';

function ForceStartTour() {
	const { startTour } = useQuickTour();
	useEffect(() => {
		startTour();
		// Mount-only: `startTour` isn't memoized by QuickTourProvider, so a reactive dependency
		// here re-fires on every provider re-render (including the one `skipTour()` causes),
		// immediately reopening the tour right after any test closes it.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return null;
}

/**
 * Regression: the tour overlay had no `role="dialog"`/`aria-modal`, never moved focus into
 * itself, and didn't trap Tab — a keyboard user continued tabbing through the underlying page
 * instead of the tour's own Prev/Next/Skip controls, and screen readers got no announcement
 * that a dialog had opened.
 */
describe('QuickTourOverlay focus management', () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
		// QuickTourProvider auto-starts the tour itself when local data is empty and this flag
		// is unset — an async check that can race with this test's explicit `startTour()` call
		// and reopen the tour right after it's closed. Marking it "seen" up front means only
		// the explicit call in ForceStartTour drives the tour here.
		localStorage.setItem(APP_QUICK_TOUR_SEEN, 'true');
	});

	async function renderActiveTour() {
		render(
			<QuickTourProvider totalSteps={QUICK_TOUR_STEPS.length}>
				<ForceStartTour />
				<QuickTourOverlay />
			</QuickTourProvider>
		);
		await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
	}

	it('exposes proper dialog semantics and moves focus into itself', async () => {
		await renderActiveTour();

		const dialog = screen.getByRole('dialog');
		expect(dialog).toHaveAttribute('aria-modal', 'true');
		expect(dialog).toHaveAttribute('aria-labelledby');
		expect(dialog).toHaveAttribute('aria-describedby');
		expect(dialog).toHaveFocus();
	});

	it('traps Tab so it cycles within the dialog instead of escaping to the page', async () => {
		await renderActiveTour();
		const user = userEvent.setup();
		const dialog = screen.getByRole('dialog');

		const focusable = dialog.querySelectorAll('button');
		expect(focusable.length).toBeGreaterThan(1);
		const last = focusable[focusable.length - 1] as HTMLElement;

		last.focus();
		await user.tab();
		// Wrapped back to the first focusable control inside the dialog, not out to the page.
		expect(dialog.contains(document.activeElement)).toBe(true);
		expect(document.activeElement).toBe(focusable[0]);

		(focusable[0] as HTMLElement).focus();
		await user.tab({ shift: true });
		expect(dialog.contains(document.activeElement)).toBe(true);
		expect(document.activeElement).toBe(last);
	});

	it('closes on Escape', async () => {
		await renderActiveTour();
		fireEvent.keyDown(window, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
	});
});
