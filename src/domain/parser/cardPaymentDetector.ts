// Heuristic: does a bank/SMS/statement line describe PAYING a credit card bill, as opposed to
// spending on one? The distinction matters because a card payment is a movement between the
// user's own accounts (bank -> card), not an expense on either — recorded as a plain expense it
// is counted as spending, and the card's outstanding balance never goes down.
//
// Deliberately conservative: a false positive only adds a "looks like a card payment" hint the
// user can ignore, but the wording below still avoids the generic words "payment" and "card" on
// their own, because ordinary purchase alerts use both ("Payment of Rs.500 at AMAZON using card
// ending 1234").

/** Money leaving an account to pay a card ("CREDIT CARD PAYMENT", "BILLPAY ... CARD", ...). */
const OUTGOING_PATTERNS: RegExp[] = [
	/credit\s*card\s*(?:bill\s*)?(?:payment|pmt|pay)\b/i,
	/\bcc\s*(?:bill\s*)?(?:payment|pmt|pay)\b/i,
	/\bcard\s*(?:bill|dues?|outstanding)\b/i,
	/\btowards\s+(?:your\s+)?(?:credit\s+)?card\b/i,
	/\bpayment\s+(?:to|towards|for)\s+(?:your\s+)?(?:credit\s+)?card\b/i,
	/\b(?:bill\s*pay|billpay)\b.*\bcard\b/i
];

/** Money arriving on the card side ("PAYMENT RECEIVED", "THANK YOU FOR YOUR PAYMENT", ...). */
const INCOMING_PATTERNS: RegExp[] = [
	/\bpayment\s+(?:of\s+(?:(?:rs|inr)\.?\s*)?[\d,]+(?:\.\d+)?\s+)?(?:received|credited)\b/i,
	/\bthank\s*you\s+for\s+(?:the\s+|your\s+)?payment\b/i,
	/\bpayment\s*[-–—]?\s*thank\s*you\b/i,
	/\bcard\s+payment\s+(?:received|credited)\b/i
];

export type CardPaymentSide = 'outgoing' | 'incoming';

/** Which side of a card payment `text` describes, or `null` if it doesn't look like one. */
export function detectCardPayment(text: string | null | undefined): CardPaymentSide | null {
	if (!text) return null;
	if (OUTGOING_PATTERNS.some((pattern) => pattern.test(text))) return 'outgoing';
	if (INCOMING_PATTERNS.some((pattern) => pattern.test(text))) return 'incoming';
	return null;
}

export function looksLikeCardPayment(text: string | null | undefined): boolean {
	return detectCardPayment(text) !== null;
}
