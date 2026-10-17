// Reads a captured bank SMS or payment-app notification. Separate from the Quick Add parser
// (which stays as it is for pasted text): that one is forgiving by design — the user is watching
// and fixes anything it gets wrong — whereas captured messages are filed without anyone looking,
// so this one prefers "could not read it" over a confident wrong answer. In particular it:
//   - matches whole words, so "present" is not "sent" and "unpaid" is not "paid";
//   - takes the direction from the EARLIEST verb, so "Rs 500 credited ... debit card" is income;
//   - only reads account digits that follow "A/c" or "card", or sit behind a mask ("XX1234"), so
//     "Rs 1234.00" is never an account.
import { parseAmount } from '../parser/quickAddParser';
import { parseDateFromText, parseTimeFromText } from '../parser/dateText';
import { detectCardPayment } from '../parser/cardPaymentDetector';
import { isForeignCurrencyOnly } from './captureFilter';
import {
	messageText,
	type CaptureInstrument,
	type CapturePayload,
	type ParsedCapture
} from './captureTypes';

// "debit card", "credit card" and "credit limit" name an instrument, not a direction.
const INSTRUMENT_PHRASES = /\b(?:debit|credit)\s+(?:cards?|limit)\b/gi;

// What the message says the money moved through. A credit-card cue wins over a debit-card one
// ("Credit Card ... debit"), and a bare "Card XX1234" says neither, so it stays unknown. Brand
// names that only issue cards (Amex, SBI Card, OneCard) count as credit cards.
const CREDIT_CARD_CUE =
	/\b(?:credit\s*cards?|cr\.?\s*card|cc|amex|american\s+express|sbi\s+card|one\s*card|diners(?:\s+club)?)\b/i;
const DEBIT_CARD_CUE = /\bdebit\s*cards?\b/i;

function detectInstrument(text: string, accountTail: string | null): CaptureInstrument | null {
	if (CREDIT_CARD_CUE.test(text)) return 'credit_card';
	if (DEBIT_CARD_CUE.test(text)) return 'debit_card';
	if (/\bUPI\b/i.test(text)) return 'upi';
	return accountTail ? 'account' : null;
}

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

// Card alerts that never say "debited" or "spent": "has been used for a transaction of", "swiped at",
// "Txn of INR ... done on". Only read when no verb above matched, because they are weaker evidence:
// "Transaction of Rs 500 credited to your account" must stay income, which the earliest-verb rule
// above guarantees only if these are not competing with it.
const WEAK_EXPENSE_PATTERN =
	/\b(?:used\s+(?:for|at|on)|swiped|(?:txn|transaction)\s+of|payment\s+of|made\s+(?:at|on)|done\s+(?:at|on))\b/i;

const CARD_USE_CUE =
	/\b(?:using|used|use of|transaction|txn|swipe[d]?|purchase[d]?|charge[sd]?)\b/i;

function parseDirection(
	text: string,
	instrument: CaptureInstrument | null
): { type: 'income' | 'expense'; guessed: boolean } | null {
	const cleaned = text.replace(INSTRUMENT_PHRASES, ' ');
	let best: { index: number; type: 'income' | 'expense' } | null = null;
	for (const rule of DIRECTION_RULES) {
		const match = rule.pattern.exec(cleaned);
		if (match && (best === null || match.index < best.index)) {
			best = { index: match.index, type: rule.type };
		}
	}
	if (best) return { type: best.type, guessed: false };

	// A credit-card bill payment ("Thank you for your payment") has no verb either, and is money
	// going the other way — better unreadable than filed as spending.
	if (detectCardPayment(cleaned) !== null) return null;
	if (WEAK_EXPENSE_PATTERN.test(cleaned)) return { type: 'expense', guessed: false };
	// Nothing said which way, but a card alert that talks about using the card is a charge. Not
	// merely mentioning a card: "Your credit card limit is Rs.50,000" has an amount and no movement.
	if (instrument === 'credit_card' && CARD_USE_CUE.test(cleaned)) {
		return { type: 'expense', guessed: true };
	}
	return null;
}

// "A/c XX1234", "A/C *1234", "Acct no. XXXX1234", "account ending 1234", "a/c 123456789012",
// "A/c XXXX XXXX 1234". Mask runs must be separated by whitespace so the pattern cannot backtrack.
const ACCOUNT_TAIL =
	/\b(?:a\/?c|acct?|account)\b\.?\s*(?:no\.?|number|#)?\s*[:-]?\s*(?:ending\s*(?:with|in)?\s*)?(?:[xX*•.-]+\s+)*[xX*•.-]*\s*(\d{3,16})\b/i;
// "Credit Card ending 5678", "card x5678", "Card no. XX5678", "card XXXX-1234", "card ending 51001",
// and the abbreviation banks use in short alerts: "HDFC CC 1234".
const CARD_TAIL =
	/\b(?:card|cc)\b(?:\s+(?:no\.?|number))?\s*(?:ending\s*(?:with|in)?\s*)?[:-]?\s*(?:[xX*•-]+\s+)*[xX*•-]*\s*(\d{4,6})\b/i;
// A masked number with no "A/c" in front ("from HDFC Bank XX1234"). Needs two or more mask characters
// so a plain amount can never be read as one, and not a VPA like "xx123@bank".
const MASKED_TAIL = /(?<![A-Za-z0-9])(?:[xX*•]{2,}[\s-]+)*[xX*•]{2,}[\s-]?(\d{3,6})\b(?!@)/;

function lastDigits(digits: string): string {
	return digits.length > 4 ? digits.slice(-4) : digits;
}

/** The last digits of the account and of the card a message names, each at most four digits. */
export function extractAccountTails(text: string): {
	accountTail: string | null;
	cardTail: string | null;
} {
	const account = ACCOUNT_TAIL.exec(text)?.[1];
	const card = CARD_TAIL.exec(text)?.[1];
	const masked = !account && !card ? MASKED_TAIL.exec(text)?.[1] : undefined;
	const own = account ?? masked;
	return {
		accountTail: own ? lastDigits(own) : null,
		cardTail: card ? lastDigits(card) : null
	};
}

const REF_NO =
	/\b(?:ref(?:erence)?\s*(?:no|number|#)?|refno|upi|utr|rrn|txn\s*(?:id|no)?)\.?\s*[:#-]?\s*(\d{9,18})\b/i;
// Axis-style "UPI/P2M/548275113159/MERCHANT" carries the reference inside the path.
const UPI_PATH_REF = /\bUPI\/(?:P2[MA]|CR|DR)\/(\d{9,18})\b/i;

/** The bank's reference number in a message or statement line, if it names one. */
export function extractRefNo(text: string): string | null {
	return REF_NO.exec(text)?.[1] ?? UPI_PATH_REF.exec(text)?.[1] ?? null;
}

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
// Card alerts name the shop after "on", "towards" or "Info:" rather than "at"/"to"
// ("spent using ICICI Bank Card XX1234 on 12-Oct-26 on NETFLIX.COM"). These are read only when no
// at/to/from/by phrase gave a usable name, because "on" is mostly followed by a date.
const CARD_PREPOSITION = new RegExp(
	String.raw`\b(on|towards|info)\s*[:-]?\s*(${NAME_CHARS})${NAME_STOP}`,
	'gi'
);

// Filler words, plus the pieces of a time or link that sit after "at" ("at 12:34 PM IST", "at
// https://..."): none of them is a shop.
const NOT_A_NAME =
	/^(?:your|the|a|an|my|you|me|a\/c|ac|acct|account|card|vpa|upi|bank|https?|www|am|pm|ist|utc|gmt|date|amex|visa|mastercard|rupay|credit|debit)\b/;
// "Mon", "Oct 5": a weekday or month that is really the start of a date, not "Sun Pharma".
const DATE_WORD =
	/^(?:mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?(?:\s*,?\s*\d|\s*$)/;

/** A name that is really the user's own bank or account, or a filler word. */
function isUnusableName(name: string): boolean {
	const lower = name.trim().toLowerCase();
	if (lower.length < 3) return true;
	if (NOT_A_NAME.test(lower) || DATE_WORD.test(lower)) return true;
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
	const cardPhrase = [...text.matchAll(CARD_PREPOSITION)]
		.map((m) => cleanName(m[2]))
		.reverse()
		.find((name) => !isUnusableName(name));
	return cardPhrase ?? null;
}

/**
 * Reads one message. Returns `null` when it cannot say with confidence how much moved and which
 * way — the caller counts those as unreadable and discards the text rather than guessing.
 */
export function parseCapturedMessage(payload: CapturePayload): ParsedCapture | null {
	const text = messageText(payload);
	// "USD 12.00 spent": the app tracks rupees, so a foreign amount is never read as one.
	if (isForeignCurrencyOnly(text)) return null;
	const amount = parseAmount(text);
	if (amount === null || amount <= 0) return null;

	const tails = extractAccountTails(text);
	const instrument = detectInstrument(text, tails.accountTail);
	const direction = parseDirection(text, instrument);
	if (direction === null) return null;

	return {
		amount,
		type: direction.type,
		merchantText: parseMerchant(text, direction.type),
		...tails,
		txnDate: parseDateFromText(text),
		txnTime: parseTimeFromText(text),
		refNo: extractRefNo(text),
		isCardPayment: detectCardPayment(text) !== null,
		instrument,
		directionGuessed: direction.guessed
	};
}
