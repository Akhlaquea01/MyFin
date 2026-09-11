import { describe, it, expect } from 'vitest';
import { parseSharedText } from '../../src/lib/shareTarget';

// Spec 008, User Story 1: resolves the text an OS share hands over, matching the priority
// order most share sources use (research.md §4) — an SMS app typically shares its
// notification body as `text`, so that takes priority over `url`/`title`.
describe('parseSharedText', () => {
	it('returns text when present', () => {
		expect(parseSharedText({ text: 'Rs.250.00 debited from A/c XX1234' })).toBe(
			'Rs.250.00 debited from A/c XX1234'
		);
	});

	it('falls back to url when text is absent', () => {
		expect(parseSharedText({ url: 'https://example.com/receipt' })).toBe(
			'https://example.com/receipt'
		);
	});

	it('falls back to url when text is empty', () => {
		expect(parseSharedText({ text: '', url: 'https://example.com/receipt' })).toBe(
			'https://example.com/receipt'
		);
	});

	it('falls back to title when text and url are both absent', () => {
		expect(parseSharedText({ title: 'Payment confirmation' })).toBe('Payment confirmation');
	});

	it('prefers text over url over title when more than one is present', () => {
		expect(
			parseSharedText({
				text: 'body text',
				url: 'https://example.com',
				title: 'a title'
			})
		).toBe('body text');
		expect(parseSharedText({ url: 'https://example.com', title: 'a title' })).toBe(
			'https://example.com'
		);
	});

	it('returns null when nothing is present or everything is empty', () => {
		expect(parseSharedText({})).toBeNull();
		expect(parseSharedText({ text: '', url: '', title: '' })).toBeNull();
	});
});
