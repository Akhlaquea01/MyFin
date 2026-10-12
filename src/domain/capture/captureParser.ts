// Reads a captured bank SMS or payment-app notification. Separate from the Quick Add parser
// (which stays as it is for pasted text): that one is forgiving by design — the user is watching
// and fixes anything it gets wrong — whereas captured messages are filed without anyone looking,
// so this one prefers "could not read it" over a confident wrong answer. In particular it:
//   - matches whole words, so "present" is not "sent" and "unpaid" is not "paid";
//   - takes the direction from the EARLIEST verb, so "Rs 500 credited ... debit card" is income;
//   - only reads account digits that follow "A/c" or "card", so "Rs 1234.00" is never an account.
import { parseAmount } from '../parser/quickAddParser';
import { parseDateFromText } from '../parser/dateText';
import { detectCardPayment } from '../parser/cardPaymentDetector';
import { messageText, type CapturePayload, type ParsedCapture } from './captureTypes';

// "debit card", "credit card" and "credit limit" name an instrument, not a direction.
const INSTRUMENT_PHRASES = /\b(?:debit|credit)\s+(?:cards?|limit)\b/gi;

interface DirectionRule {
	type: 'income' | 'expense';
	pattern: RegExp;
}

// "paid you" / "sent you" are money coming IN, so the plain verbs refuse to match before "you".
const DIRECTION_RULES: DirectionRule[] = [
	{
		type: 'expense',
		pattern:
			/\b(?:debited|debit|spent|withdrawn|withdrawal|purchase[d]?|deducted|charged|transferred\s+from|paid(?!\s+you)|sent(?!\s+you))\b/i
	},
	{
		type: 'income',
		pattern:
			/\b(?:credited|credit|received|deposited|refund(?:ed)?|reversed|reversal|cashback|transferred\s+to\s+your|(?:paid|sent)\s+you)\b/i
	}
];

function parseDirection(text: string): 'income' | 'expense' | null {
	const cleaned = text.replace(INSTRUMENT_PHRASES, ' ');
	let best: { index: number; type: 'income' | 'expense' } | null = null;
	for (const rule of DIRECTION_RULES) {
		const match = rule.pattern.exec(cleaned);
		if (match && (best === null || match.index < best.index)) {
			best = { index: match.index, type: rule.type };
		}
	}
	return best?.type ?? null;
}

// "A/c XX1234", "A/C *1234", "Acct no. XXXX1234", "account ending 1234", "a/c 123456789012".
const ACCOUNT_TAIL =
	/\b(?:a\/?c|acct?|account)\b\.?\s*(?:no\.?|number|#)?\s*[:-]?\s*(?:ending\s*(?:with|in)?\s*)?[xX*•.-]*\s*(\d{3,16})\b/i;
// "Credit Card ending 5678", "card x5678", "Card no. XX5678", "card ending with 5678".
const CARD_TAIL =
	/\bcard\b(?:\s+(?:no\.?|number))?\s*(?:ending\s*(?:with|in)?\s*)?[:-]?\s*[xX*•]*\s*(\d{4})\b/i;

function lastDigits(digits: string): string {
	return digits.length > 4 ? digits.slice(-4) : digits;
}

const REF_NO =
	/\b(?:ref(?:erence)?\s*(?:no|number|#)?|refno|upi|utr|rrn|txn\s*(?:id|no)?)\.?\s*[:#-]?\s*(\d{9,18})\b/i;

// ---- merchant -------------------------------------------------------------------------------

const NAME_CHARS = String.raw`[A-Za-z][A-Za-z0-9 &.'@_-]*?`;
// Words that end a name: the next clause of the message starts here.
const NAME_STOP = String.raw`(?=\s+(?:on|at|your|ref|refno|towards|via|using|through|upi|utr|a\/c|ac|acct|account|card|avl|bal|available|if|dated|date|for|from|to|is|has|was|and|vpa|linked|txn|trf|not)\b|[.,;:()]|$)`;

const UPI_PATH = /\bUPI\/(?:P2[MA]|CR|DR)\/\d+\/([A-Za-z][A-Za-z0-9 &.'-]{1,40}?)(?=[/\s.,;]|$)/i;
const TRANSFER_TO = new RegExp(
	String.raw`\b(?:trf|transfer(?:red)?)\s+to\s+(${NAME_CHARS})${NAME_STOP}`,
	'i'
);
const VPA = /\bvpa\s+([A-Za-z][A-Za-z._-]{2,})@/i;
const BANK_TRANSFER =
	/\b(?:NEFT|IMPS|RTGS)[-\s]+(?:[A-Z]{4}\d{5,}[-\s]+)?([A-Za-z][A-Za-z0-9 &.']*?)(?=\s*-|\s*[.,;]|\s+(?:on|ref|refno)\b|$)/;
const AFTER_TIME =
	/\b\d{1,2}:\d{2}(?::\d{2})?\s+([A-Za-z][A-Za-z0-9 &.'-]*?)(?=\s+(?:avl|bal|available|ref|lmt|limit)\b|[.,;]|$)/i;
const PREPOSITION = new RegExp(String.raw`\b(at|to|from|by)\s+(${NAME_CHARS})${NAME_STOP}`, 'gi');

/** A name that is really the user's own bank or account, or a filler word. */
function isUnusableName(name: string): boolean {
	const lower = name.trim().toLowerCase();
	if (lower.length < 3) return true;
	if (/^(?:your|the|a|an|my|you|me|a\/c|ac|acct|account|card|vpa|upi|bank)\b/.test(lower))
		return true;
	if (/\bbank\b/.test(lower) && lower.split(/\s+/).length <= 3) return true;
	return !/[a-z]/.test(lower);
}

function cleanName(name: string): string {
	return name.replace(/\s+/g, ' ').replace(/^[\s.&'-]+|[\s.&'-]+$/g, '');
}

function parseMerchant(text: string, type: 'income' | 'expense'): string | null {
	const direct = [UPI_PATH, TRANSFER_TO, BANK_TRANSFER, AFTER_TIME];
	for (const pattern of direct) {
		const candidate = pattern.exec(text)?.[1];
		if (candidate && !isUnusableName(cleanName(candidate))) return cleanName(candidate);
	}
	const vpa = VPA.exec(text)?.[1];
	if (vpa && /^[A-Za-z][A-Za-z._-]+$/.test(vpa)) {
		const spoken = cleanName(vpa.replace(/[._-]+/g, ' ').replace(/\bupi\b/gi, ''));
		if (!isUnusableName(spoken)) return spoken;
	}

	// Money going out is "to/at <shop>"; money coming in is "from/by <payer>".
	const preferred = type === 'expense' ? ['to', 'at'] : ['from', 'by'];
	const fallback = type === 'expense' ? ['from', 'by'] : ['to', 'at'];
	const phrases = [...text.matchAll(PREPOSITION)].map((m) => ({
		preposition: m[1].toLowerCase(),
		name: cleanName(m[2])
	}));
	for (const group of [preferred, fallback]) {
		const hit = [...phrases]
			.reverse()
			.find((p) => group.includes(p.preposition) && !isUnusableName(p.name));
		if (hit) return hit.name;
	}
	return null;
}

/**
 * Reads one message. Returns `null` when it cannot say with confidence how much moved and which
 * way — the caller counts those as unreadable and discards the text rather than guessing.
 */
export function parseCapturedMessage(payload: CapturePayload): ParsedCapture | null {
	const text = messageText(payload);
	const amount = parseAmount(text);
	if (amount === null || amount <= 0) return null;

	const type = parseDirection(text);
	if (type === null) return null;

	const account = ACCOUNT_TAIL.exec(text)?.[1];
	const card = CARD_TAIL.exec(text)?.[1];

	return {
		amount,
		type,
		merchantText: parseMerchant(text, type),
		accountTail: account ? lastDigits(account) : null,
		cardTail: card ?? null,
		txnDate: parseDateFromText(text),
		refNo: REF_NO.exec(text)?.[1] ?? null,
		isCardPayment: detectCardPayment(text) !== null
	};
}
