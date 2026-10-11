// Rule-based Quick Add / bulk-text parser (User Story 4, research.md #9). Replaces the
// SMS auto-ingestion a browser can't do (spec.md §7): the user pastes or bulk-imports
// payment-notification-style text and this extracts amount/merchant/direction with a
// confidence score. Below the confidence threshold, callers must route to manual entry
// (FR-021) rather than guess.

import { parseMoneyToMinorUnits } from '../shared/money';

export type ParsedType = 'income' | 'expense' | null;

export interface ParsedCandidate {
	/** Smallest currency unit (paise), unsigned — direction is `type`. Null if not found. */
	amount: number | null;
	merchantText: string | null;
	type: ParsedType;
	confidence: number; // 0..1
}

export const CONFIDENCE_THRESHOLD = 0.6;

// A number as it appears in a bank message: digits with optional thousands separators (Indian
// "1,23,456" grouping included) and up to two decimals. Must START with a digit, and must END
// cleanly: "8.165" is not "8.16" followed by a stray 5, it is not a valid amount at all.
const NUMBER = String.raw`(\d[\d,]*(?:\.\d{1,2})?)(?!\d|\.\d)`;
// "Rs", "Rs." or "INR" (not as the tail of a longer word) or the rupee sign. The (?<![a-z]) keeps
// "hours 500" — which contains "rs 500" — from being read as an amount.
const CURRENCY = String.raw`(?:(?<![a-z])(?:rs\.?|inr)|₹)`;

// Currency BEFORE the number ("Rs.500", "₹ 1,234.50", "INR500") …
const PREFIXED_AMOUNT = new RegExp(String.raw`${CURRENCY}\s*${NUMBER}`, 'iu');
// … or AFTER it ("1234.56 INR", "500 Rs"). The number must not be glued to a preceding letter,
// digit or separator: in "A/c XX1234 Rs.500.00" the digits "1234" sit right before "Rs", and were
// read as the amount (₹1,234.00) instead of the ₹500.00 that follows. Nor may the currency be
// followed by another number, with or without its dot — then it belongs to THAT number
// ("Card 1234 Rs 500" and "8, Rs.500": ₹500, not ₹1,234 / ₹8).
const SUFFIXED_AMOUNT = new RegExp(
	String.raw`(?<![a-z\d.,])${NUMBER}\s*(?:(?:rs\.?|inr)(?![a-z])|₹)(?!\.?\s*\d)`,
	'iu'
);

// Messages that name no currency at all: "debited by 500.00", "credited with 1,200", "Amount: 750".
// The number has to come straight after a verb/label that introduces an amount (and an optional
// "by/for/of/with"), which is what keeps an account number ("debited from A/c 123456789012"), a
// reference or a date from being mistaken for the amount.
const KEYWORD_AMOUNT = new RegExp(
	String.raw`\b(?:debited|credited|spent|paid|received|withdrawn|deposited|sent|purchase\s+of|txn\s+of|transaction\s+of|amount|amt)\b\s*(?:by|for|of|with|is)?\s*[:\-]?\s*${NUMBER}`,
	'iu'
);

/** Account numbers and references are long digit runs; no real transaction is this large. */
const MAX_INTEGER_DIGITS = 9;

const DEBIT_KEYWORDS = ['debited', 'spent', 'paid', 'sent', 'purchase', 'withdrawn', 'debit'];
const CREDIT_KEYWORDS = ['credited', 'received', 'refund', 'deposited', 'credit'];

// Captures the phrase after a preposition commonly followed by a merchant/payee name, up
// to a stopword (on/your/ref/towards/via/a\/c/from) or punctuation/end of string. Global,
// because bank notifications often contain more than one at/to/from phrase (e.g. "to your
// account ... from John Doe") — the LAST one is taken as the real counterparty, since the
// earlier ones are typically the user's own account, not the other party.
const MERCHANT_PATTERN =
	/\b(?:at|to|from)\s+([A-Za-z0-9][A-Za-z0-9 &.'-]*?)(?=\s+(?:on|your|ref|towards|via|a\/c|acct?\b|from)|[.,]|$)/gi;

export function parseAmount(text: string): number | null {
	// The transaction amount is the FIRST amount a message states ("... Avl Bal Rs.9,000" comes
	// after it), whichever of the three ways it is written — so take the earliest match of any form,
	// not the first form that happens to match anywhere.
	const matches = [PREFIXED_AMOUNT, SUFFIXED_AMOUNT, KEYWORD_AMOUNT]
		.map((pattern) => text.match(pattern))
		.filter((m): m is RegExpMatchArray => m !== null && m[1] !== undefined);
	matches.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
	const raw = matches[0]?.[1];
	if (!raw) return null;
	if (raw.split('.')[0].replace(/,/g, '').length > MAX_INTEGER_DIGITS) return null;
	// Exact string -> integer paise; scaling a float by 100 loses a paise at half-subunit
	// boundaries (Math.round(8.165 * 100) === 816). Constitution Principle VI.
	return parseMoneyToMinorUnits(raw);
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
