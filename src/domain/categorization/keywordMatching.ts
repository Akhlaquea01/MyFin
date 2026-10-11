import type { CategorizationRule } from '../entities';

// Pure matching for keyword ("description contains …") categorization rules. A keyword rule maps
// a piece of text to a category, so it applies to any transaction whose description mentions it —
// including every spelling a bank statement produces for the same business ("UPI-SWIGGY-8812",
// "SWIGGY BANGALORE", "Swiggy Instamart"), which merchant rules cannot unify because each distinct
// string is its own merchant.

/** Shortest keyword accepted. Two letters ("pay", "at"…) match half the ledger. */
export const MIN_KEYWORD_LENGTH = 3;

/**
 * Lower-cases `text` and collapses every run of punctuation/whitespace to a single space, so
 * "UPI/SWIGGY-88" and "swiggy" compare on their words, not on separators or case. Unicode-aware:
 * letters, combining marks (which carry vowels in Indic scripts) and digits in any script are kept.
 */
export function normalizeMatchText(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
		.trim();
}

export type KeywordValidation = { ok: true; normalized: string } | { ok: false; message: string };

/** A keyword must carry at least `MIN_KEYWORD_LENGTH` letters/digits once normalized. */
export function validateKeyword(raw: string): KeywordValidation {
	const normalized = normalizeMatchText(raw);
	if (normalized.replace(/ /g, '').length < MIN_KEYWORD_LENGTH) {
		return {
			ok: false,
			message: `Enter at least ${MIN_KEYWORD_LENGTH} letters or digits — shorter keywords match too much.`
		};
	}
	return { ok: true, normalized };
}

/**
 * Whether `normalizedText` contains `normalizedKeyword` starting at the beginning of a word.
 * "uber" matches "uber india" and "uber" but not "suberb"; "swiggy" still matches
 * "swiggyinstamart" (a keyword may be the start of a longer word, which is how merchants often
 * run brand and product together). Both arguments must already be normalized.
 */
export function textMatchesKeyword(normalizedText: string, normalizedKeyword: string): boolean {
	if (!normalizedKeyword) return false;
	return ` ${normalizedText}`.includes(` ${normalizedKeyword}`);
}

/** Whether a keyword rule's keyword occurs in `text` (any case/punctuation). */
export function keywordRuleMatches(
	rule: Pick<CategorizationRule, 'keyword'>,
	text: string
): boolean {
	if (!rule.keyword) return false;
	return textMatchesKeyword(normalizeMatchText(text), normalizeMatchText(rule.keyword));
}

/**
 * The keyword rule that applies to `text`, or `null`. When several match, the LONGEST keyword
 * wins — "amazon prime" is more specific than "amazon", so a Prime renewal is filed as a
 * subscription rather than as shopping — and an exact tie goes to the older rule, so the outcome
 * never depends on storage order. `rules` must already be narrowed to live, non-stale keyword
 * rules; this performs no I/O and never mutates its input.
 */
export function pickKeywordRule(
	rules: CategorizationRule[],
	text: string
): CategorizationRule | null {
	const normalizedText = normalizeMatchText(text);
	if (!normalizedText) return null;

	let best: { rule: CategorizationRule; length: number } | null = null;
	for (const rule of rules) {
		if (!rule.keyword) continue;
		const normalizedKeyword = normalizeMatchText(rule.keyword);
		if (!textMatchesKeyword(normalizedText, normalizedKeyword)) continue;
		const length = normalizedKeyword.length;
		if (
			!best ||
			length > best.length ||
			(length === best.length &&
				(rule.createdAt < best.rule.createdAt ||
					(rule.createdAt === best.rule.createdAt && rule.id < best.rule.id)))
		) {
			best = { rule, length };
		}
	}
	return best?.rule ?? null;
}
