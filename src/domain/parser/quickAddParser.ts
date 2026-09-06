// Rule-based Quick Add / bulk-text parser (User Story 4, research.md #9). Replaces the
// SMS auto-ingestion a browser can't do (spec.md §7): the user pastes or bulk-imports
// payment-notification-style text and this extracts amount/merchant/direction with a
// confidence score. Below the confidence threshold, callers must route to manual entry
// (FR-021) rather than guess.

export type ParsedType = 'income' | 'expense' | null;

export interface ParsedCandidate {
	/** Smallest currency unit (paise), unsigned — direction is `type`. Null if not found. */
	amount: number | null;
	merchantText: string | null;
	type: ParsedType;
	confidence: number; // 0..1
}

export const CONFIDENCE_THRESHOLD = 0.6;

const AMOUNT_PATTERN =
	/(?:rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s*(?:rs\.?|inr)/i;

const DEBIT_KEYWORDS = ['debited', 'spent', 'paid', 'sent', 'purchase', 'withdrawn', 'debit'];
const CREDIT_KEYWORDS = ['credited', 'received', 'refund', 'deposited', 'credit'];

// Captures the phrase after a preposition commonly followed by a merchant/payee name, up
// to a stopword (on/your/ref/towards/via/a\/c/from) or punctuation/end of string. Global,
// because bank notifications often contain more than one at/to/from phrase (e.g. "to your
// account ... from John Doe") — the LAST one is taken as the real counterparty, since the
// earlier ones are typically the user's own account, not the other party.
const MERCHANT_PATTERN =
	/\b(?:at|to|from)\s+([A-Za-z0-9][A-Za-z0-9 &.'-]*?)(?=\s+(?:on|your|ref|towards|via|a\/c|acct?\b|from)|[.,]|$)/gi;

function parseAmount(text: string): number | null {
	const match = text.match(AMOUNT_PATTERN);
	const raw = match?.[1] ?? match?.[2];
	if (!raw) return null;
	const value = parseFloat(raw.replace(/,/g, ''));
	if (!Number.isFinite(value)) return null;
	return Math.round(value * 100);
}

function parseType(text: string): ParsedType {
	const lower = text.toLowerCase();
	if (DEBIT_KEYWORDS.some((kw) => lower.includes(kw))) return 'expense';
	if (CREDIT_KEYWORDS.some((kw) => lower.includes(kw))) return 'income';
	return null;
}

function parseMerchant(text: string): string | null {
	const matches = [...text.matchAll(MERCHANT_PATTERN)];
	const last = matches.at(-1);
	return last ? last[1].trim() : null;
}

export function parseQuickAddText(rawText: string): ParsedCandidate {
	const text = rawText.trim();
	const amount = parseAmount(text);
	const type = parseType(text);
	const merchantText = parseMerchant(text);

	let confidence = 0;
	if (amount !== null) confidence += 0.5;
	if (type !== null) confidence += 0.3;
	if (merchantText !== null) confidence += 0.2;

	return { amount, merchantText, type, confidence };
}

export function isConfident(candidate: ParsedCandidate): boolean {
	return candidate.confidence >= CONFIDENCE_THRESHOLD && candidate.amount !== null;
}
