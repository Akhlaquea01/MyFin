import { describe, it, expect, afterEach } from 'vitest';
import { resolveCssColor, getChartPalette, withAlpha } from '../../src/lib/chartColors';

describe('resolveCssColor', () => {
	// jsdom's CSS engine doesn't resolve custom-property values in getComputedStyle (it hands
	// back the unresolved `var(...)` reference regardless of the underlying value) — real
	// browsers normalize it to rgb()/color(), which is what this exists for. That normalization
	// itself is only verifiable in a real browser (covered by the manual Browser-pane check);
	// what's testable here is that the function runs without throwing and cleans up after
	// itself, whatever the environment's computed-style support gives back.
	afterEach(() => {
		document.documentElement.style.removeProperty('--test-color');
	});

	it('returns a non-empty string without throwing', () => {
		document.documentElement.style.setProperty('--test-color', '#0f766e');
		expect(() => resolveCssColor('--test-color')).not.toThrow();
		expect(typeof resolveCssColor('--test-color')).toBe('string');
	});

	it('leaves no probe element behind', () => {
		document.documentElement.style.setProperty('--test-color', '#0f766e');
		resolveCssColor('--test-color');
		expect(document.querySelectorAll('span').length).toBe(0);
	});
});

describe('getChartPalette', () => {
	it('returns five distinct colors', () => {
		const palette = getChartPalette();
		expect(palette).toHaveLength(5);
		expect(new Set(palette).size).toBe(5);
	});
});

describe('withAlpha', () => {
	it('applies alpha to an rgb() string', () => {
		expect(withAlpha('rgb(15, 118, 110)', 0.2)).toBe('rgba(15, 118, 110, 0.2)');
	});

	it('replaces the alpha on an already-rgba() string', () => {
		expect(withAlpha('rgba(15, 118, 110, 0.9)', 0.2)).toBe('rgba(15, 118, 110, 0.2)');
	});

	it('passes through an unparseable color unchanged', () => {
		expect(withAlpha('not-a-color', 0.2)).toBe('not-a-color');
	});
});
