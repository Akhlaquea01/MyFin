import { describe, it, expect } from 'vitest';
import {
	MIN_KEYWORD_LENGTH,
	keywordRuleMatches,
	normalizeMatchText,
	pickKeywordRule,
	textMatchesKeyword,
	validateKeyword
} from '../../src/domain/categorization/keywordMatching';
import type { CategorizationRule } from '../../src/domain/entities';

function rule(overrides: Partial<CategorizationRule>): CategorizationRule {
	return {
		id: 'r',
		merchantId: '__keyword__',
		merchantAliasId: null,
		categoryId: 'cat',
		tagIds: [],
		keyword: 'swiggy',
		createdAt: 1,
		updatedAt: 1,
		...overrides
	};
}

describe('normalizeMatchText', () => {
	it('lower-cases and collapses punctuation and whitespace to single spaces', () => {
		expect(normalizeMatchText('UPI/SWIGGY-8812  Bangalore')).toBe('upi swiggy 8812 bangalore');
		expect(normalizeMatchText('  M&S  Food ')).toBe('m s food');
	});

	it('keeps letters and digits in any script', () => {
		// Combining vowel signs must not split a Devanagari word apart.
		expect(normalizeMatchText('स्विगी ऑर्डर 12')).toBe('स्विगी ऑर्डर 12');
		expect(normalizeMatchText('Café Münch')).toBe('café münch');
	});

	it('returns an empty string for pure punctuation', () => {
		expect(normalizeMatchText('--/ //')).toBe('');
	});
});

describe('validateKeyword', () => {
	it('accepts a keyword and returns its normalized form', () => {
		expect(validateKeyword(' Swiggy ')).toEqual({ ok: true, normalized: 'swiggy' });
		expect(validateKeyword('Amazon-Pay')).toEqual({ ok: true, normalized: 'amazon pay' });
	});

	it(`rejects anything shorter than ${MIN_KEYWORD_LENGTH} letters or digits`, () => {
		for (const raw of ['', '  ', 'ab', 'a b', '-- 12', '!!']) {
			const result = validateKeyword(raw);
			expect(result.ok, raw).toBe(false);
		}
		expect(validateKeyword('abc').ok).toBe(true);
		expect(validateKeyword('a-b-c').ok).toBe(true);
	});
});

describe('textMatchesKeyword', () => {
	it('matches at the start of a word, anywhere in the text', () => {
		expect(textMatchesKeyword('upi swiggy 8812', 'swiggy')).toBe(true);
		expect(textMatchesKeyword('swiggy', 'swiggy')).toBe(true);
		expect(textMatchesKeyword('swiggyinstamart order', 'swiggy')).toBe(true);
		expect(textMatchesKeyword('amazon pay india', 'amazon pay')).toBe(true);
	});

	it('does not match in the middle of a word', () => {
		expect(textMatchesKeyword('suberb', 'uber')).toBe(false);
		expect(textMatchesKeyword('rubber', 'uber')).toBe(false);
	});

	it('does not match across a missing word boundary', () => {
		expect(textMatchesKeyword('amazonpay', 'amazon pay')).toBe(false);
	});

	it('never matches an empty keyword', () => {
		expect(textMatchesKeyword('anything', '')).toBe(false);
	});
});

describe('keywordRuleMatches', () => {
	it('ignores case and punctuation on both sides', () => {
		expect(keywordRuleMatches({ keyword: 'SWIGGY' }, 'upi-swiggy-8812')).toBe(true);
		expect(keywordRuleMatches({ keyword: 'swiggy' }, 'Zomato order')).toBe(false);
	});

	it('is false for a rule with no keyword', () => {
		expect(keywordRuleMatches({ keyword: null }, 'swiggy')).toBe(false);
		expect(keywordRuleMatches({}, 'swiggy')).toBe(false);
	});
});

describe('pickKeywordRule', () => {
	it('returns null when nothing matches or the text is empty', () => {
		expect(pickKeywordRule([rule({})], 'zomato')).toBeNull();
		expect(pickKeywordRule([rule({})], '')).toBeNull();
		expect(pickKeywordRule([], 'swiggy')).toBeNull();
	});

	it('prefers the longest matching keyword — "amazon prime" over "amazon"', () => {
		const general = rule({ id: 'a', keyword: 'amazon', categoryId: 'shopping' });
		const specific = rule({ id: 'b', keyword: 'amazon prime', categoryId: 'subscriptions' });
		expect(pickKeywordRule([general, specific], 'AMAZON PRIME RENEWAL')?.id).toBe('b');
		expect(pickKeywordRule([specific, general], 'AMAZON PRIME RENEWAL')?.id).toBe('b');
		// A description only the general keyword matches still falls to it.
		expect(pickKeywordRule([general, specific], 'AMAZON SELLER SERVICES')?.id).toBe('a');
	});

	it('breaks an exact tie in favour of the older rule, whatever the input order', () => {
		const older = rule({ id: 'older', keyword: 'uber', createdAt: 1 });
		const newer = rule({ id: 'newer', keyword: 'uber trip', createdAt: 5 });
		const sameLengthNewer = rule({ id: 'x-newer', keyword: 'zzzz', createdAt: 9 });
		expect(pickKeywordRule([newer, older], 'uber trip')?.id).toBe('newer'); // longer wins
		const a = rule({ id: 'a', keyword: 'cafe', createdAt: 2 });
		const b = rule({ id: 'b', keyword: 'cafe', createdAt: 1 });
		expect(pickKeywordRule([a, b], 'cafe')?.id).toBe('b');
		expect(pickKeywordRule([b, a], 'cafe')?.id).toBe('b');
		expect(pickKeywordRule([sameLengthNewer], 'zzzz')?.id).toBe('x-newer');
	});

	it('does not mutate its input', () => {
		const rules = [rule({ id: 'a' }), rule({ id: 'b', keyword: 'uber' })];
		const copy = structuredClone(rules);
		pickKeywordRule(rules, 'swiggy uber');
		expect(rules).toEqual(copy);
	});
});
