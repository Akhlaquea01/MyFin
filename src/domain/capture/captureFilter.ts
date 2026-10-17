// Decides whether an incoming message is a completed money movement worth putting in front of
// the user. Stricter than the Quick Add parser on purpose: Quick Add is something the user asked
// for, whereas a captured message arrives unprompted, so a false positive is noise in their
// queue and a false negative is one transaction they can still add by hand. Everything here
// runs after unlock, on already-opened messages — the native side only does a coarser pre-filter
// so that unrelated personal messages are never stored at all.
import { parseAmount } from '../parser/quickAddParser';
import { messageText, type CapturePayload, type ClassifyResult } from './captureTypes';

/** Longer than any real bank alert; usually a marketing blast or a forwarded thread. */
const MAX_MESSAGE_LENGTH = 1000;

/** A sender that is just a phone number is a person, not a bank. */
const PHONE_NUMBER_SENDER = /^\+?\d{8,}$/;

// What a bank alert has and a friend's "paid you Rs 500" does not: a currency-marked amount and
// the account or card digits it is about. Lets a bank alert through from a phone-number sender (a
// forward, or a bank that texts from a number). Mirrors CaptureFilter.looksLikeBankAlert on Android.
const CURRENCY_AMOUNT = /(?:\b(?:rs\.?|inr)|₹)\s*\d/i;
const ACCOUNT_OR_CARD = /\b(?:a\/?c|acct?|account|card)\b[^0-9]{0,15}\d{3,}/i;

const OTP =
	/\botp\b|one[- ]?time (?:password|pin|passcode)|verification code|\bcvv\b|\bpasscode\b|do not share|don'?t share|never share/i;

// Real debit and card alerts end with a fraud warning ("Never share OTP/CVV/PIN with anyone."). The
// warning is not an OTP message, so it is cut out before the OTP test; an actual code message names
// the code in its first sentence, which stays.
const WARNING_SENTENCE =
	/[^.!?\n]*\b(?:do not|don'?t|never|please do not|kindly do not)\s+(?:to\s+)?(?:share|disclose|reveal|give)\b[^.!?\n]*[.!?]?/gi;

/** The text with its "never share your OTP" style warnings removed. */
export function withoutWarnings(text: string): string {
	return text.replace(WARNING_SENTENCE, ' ');
}

// A code sitting next to the word that names it ("OTP 123456", "123456 is your OTP"), not an amount
// or an account mask. Keeps a code message whose own sentence carries the "do not share" warning from
// being rescued by the cut above.
const CODE_WORD = String.raw`(?:otp|one[- ]?time (?:password|pin|passcode)|verification code|passcode)`;
const CODE_DIGITS = String.raw`(?<![\d,.xX*])\d{4,8}(?![\d,]|\.\d)`;
const OTP_CODE = new RegExp(
	String.raw`\b${CODE_WORD}\b[^.!?\n]{0,60}?${CODE_DIGITS}|${CODE_DIGITS}[^.!?\n]{0,60}?\b${CODE_WORD}\b`,
	'i'
);

function isOtpMessage(text: string): boolean {
	return OTP.test(withoutWarnings(text)) || OTP_CODE.test(text);
}

const PROMO =
	/\bpre-?approved\b|\bapply now\b|\bcongratulations?\b|\bexclusive offer\b|\blimited period\b|\bclick (?:here|the link|below)\b|\bclaim (?:your|now)\b|\bkyc\b.*\b(?:update|expire|expiring|suspend|block)|\b(?:account|card)\b.*\bwill be (?:blocked|suspended|deactivated)|\bwin (?:up to|a|an)\b|\bavail (?:the|this|our) offer/i;

const FAILED =
	/\b(?:failed|declined|unsuccessful|rejected|insufficient (?:funds|balance)|could not be (?:processed|completed)|not (?:successful|processed|completed))\b/i;

// Things that have not happened yet, or that ask the user to do something.
const FUTURE_OR_REQUEST =
	/\bwill be (?:debited|credited|deducted|charged|auto-?debited)\b|\bto be (?:debited|credited|deducted|charged)\b|\bdue (?:on|by|date)\b|\bis due\b|\bmin(?:imum)?(?: amount)? due\b|\bstatement\b[^\n]{0,40}\b(?:generated|ready|due)\b|\b(?:generated|ready)\b[^\n]{0,20}\bstatement\b|\bbill (?:of|for|generated|is)\b|\breminder\b|\bupcoming\b|\bpayment request\b|\b(?:has )?requested (?:money|rs|inr|₹)|\bcollect request\b|\bpending (?:approval|collect)\b/i;

// An e-mandate / auto-pay message is a forward-looking notice (registered, scheduled, "will be
// processed") unless it says the charge already went through. A subscription billed to a credit
// card is exactly the second kind: "Your E-Mandate for NETFLIX of Rs 649 was successfully
// processed on your Credit Card".
const MANDATE = /\be-?mandate\b|\bmandate\b|\bauto-?pay\b|\bstanding instruction\b/i;
const MANDATE_COMPLETED =
	/\b(?:was|has been|have been|is)\s+(?:successfully\s+)?(?:processed|debited|charged|paid|completed|deducted)\b|\bsuccessfully\s+(?:processed|debited|charged|paid|deducted)\b/i;

// An amount in a currency the app does not track (USD 12.00, EUR 20, $5). A foreign-currency card
// charge is real money: it is kept in the unreadable list for the user to add by hand instead of
// being dropped without a trace.
const FOREIGN_AMOUNT = /(?:\b(?:usd|eur|gbp|aed|sgd|aud|cad|jpy|chf|cny|thb|myr)\b|[$€£])\s*\d/i;

// A completed movement of money. Word-bounded so "present" is not "sent" and "unpaid" is not "paid".
const TRANSACTION_VERB =
	/\b(?:debited|credited|spent|paid|received|withdrawn|deposited|sent|purchase[d]?|transferred|refund(?:ed)?|reversed|reversal|deducted|charged|payment of|txn of|transaction of|swiped|used (?:for|at)|debit|credit)\b/i;

const BALANCE = /\b(?:avl|available|ledger|closing|current)\.?\s*(?:bal(?:ance)?)\b/i;

export function classifyMessage(payload: CapturePayload): ClassifyResult {
	const text = messageText(payload);

	if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, reason: 'too-long' };

	if (
		payload.channel === 'sms' &&
		PHONE_NUMBER_SENDER.test(payload.sender.replace(/[\s-]/g, '')) &&
		!(CURRENCY_AMOUNT.test(text) && ACCOUNT_OR_CARD.test(text))
	) {
		return { ok: false, reason: 'personal-sender' };
	}

	// Checked first: an OTP message routinely quotes the amount it is for.
	if (isOtpMessage(text)) return { ok: false, reason: 'otp' };
	if (PROMO.test(text)) return { ok: false, reason: 'promo' };
	if (FAILED.test(text)) return { ok: false, reason: 'failed' };
	if (FUTURE_OR_REQUEST.test(text)) return { ok: false, reason: 'future-or-request' };
	if (MANDATE.test(text) && !MANDATE_COMPLETED.test(text)) {
		return { ok: false, reason: 'future-or-request' };
	}

	if (!TRANSACTION_VERB.test(text)) {
		return { ok: false, reason: BALANCE.test(text) ? 'balance-only' : 'not-transactional' };
	}
	// Let a foreign-currency charge through even though no rupee amount can be read from it: it lands
	// in the unreadable list with its text, instead of vanishing.
	if (isForeignCurrencyOnly(text)) return { ok: true };
	if (parseAmount(text) === null) return { ok: false, reason: 'no-amount' };

	return { ok: true };
}

/** The message states its amount in a currency other than rupees (and in no rupee amount). The
 *  app tracks one currency, so these are never filed on a guess. */
export function isForeignCurrencyOnly(text: string): boolean {
	return FOREIGN_AMOUNT.test(text) && !CURRENCY_AMOUNT.test(text);
}
