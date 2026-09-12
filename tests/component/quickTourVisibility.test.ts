import { describe, it, expect, vi, afterEach } from 'vitest';
import { isElementVisible } from '../../src/components/ui/quick-tour/QuickTourOverlay';

/**
 * Regression coverage for the desktop-tour bug: a `data-tour` target that's present in the DOM
 * but hidden by a `display:none` ancestor (the mobile nav's copy while only the desktop
 * sidebar's is meant to be visible, or vice versa) still matches `querySelector`, and its
 * `getBoundingClientRect()` is an all-zero rect that's nonetheless truthy — without this check,
 * QuickTourOverlay pinned a phantom 0x0 highlight box top-left instead of falling back to the
 * centered card.
 *
 * jsdom has no real layout engine (every element's getBoundingClientRect is always zeroed), so
 * the two cases are distinguished the same way a real browser distinguishes them: whether the
 * element has any client rects at all.
 */
describe('isElementVisible', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('is false when the element has no client rects (display:none ancestor)', () => {
		const el = document.createElement('span');
		vi.spyOn(el, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
		vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));

		expect(isElementVisible(el)).toBe(false);
	});

	it('is true for an element with a non-zero, positioned rect', () => {
		const el = document.createElement('span');
		vi.spyOn(el, 'getClientRects').mockReturnValue([
			new DOMRect(10, 20, 100, 30)
		] as unknown as DOMRectList);
		vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 100, 30));

		expect(isElementVisible(el)).toBe(true);
	});
});
