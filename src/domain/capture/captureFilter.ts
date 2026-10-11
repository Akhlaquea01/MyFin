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

const OTP =
	/\botp\b|one[- ]?time (?:password|pin|passcode)|verification code|\bcvv\b|\bpasscode\b|do not share|don'?t share|never share/i;

const PROMO =
	/\bpre-?approved\b|\bapply now\b|\bcongratulations?\b|\bexclusive offer\b|\blimited period\b|\bclick (?:here|the link|below)\b|\bclaim (?:your|now)\b|\bkyc\b.*\b(?:update|expire|expiring|suspend|block)|\b(?:account|card)\b.*\bwill be (?:blocked|suspended|deactivated)|\bwin (?:up to|a|an)\b|\bavail (?:the|this|our) offer/i;

const FAILED =
	/\b(?:failed|declined|unsuccessful|rejected|insufficient (?:funds|balance)|could not be (?:processed|completed)|not (?:successful|processed|completed))\b/i;

// Things that have not happened yet, or that ask the user to do something.
const FUTURE_OR_REQUEST =
	/\bwill be (?:debited|credited|deducted|charged|auto-?debited)\b|\bto be (?:debited|credited|deducted|charged)\b|\bmandate\b|\bdue (?:on|by|date)\b|\bis due\b|\bmin(?:imum)?(?: amount)? due\b|\bstatement\b|\bbill (?:of|for|generated|is)\b|\breminder\b|\bupcoming\b|\bpayment request\b|\b(?:has )?requested (?:money|rs|inr|₹)|\bcollect request\b|\bpending (?:approval|collect)\b/i;

// A completed movement of money. Word-bounded so "present" is not "sent" and "unpaid" is not "paid".
const TRANSACTION_VERB =
	/\b(?:debited|credited|spent|paid|received|withdrawn|deposited|sent|purchase[d]?|transferred|refund(?:ed)?|reversed|reversal|deducted|charged|payment of|txn of|transaction of|debit|credit)\b/i;

const BALANCE = /\b(?:avl|available|ledger|closing|current)\.?\s*(?:bal(?:ance)?)\b/i;

export function classifyMessage(payload: CapturePayload): ClassifyResult {
	const text = messageText(payload);

	if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, reason: 'too-long' };

	if (payload.channel === 'sms' && PHONE_NUMBER_SENDER.test(payload.sender.replace(/[\s-]/g, ''))) {
		return { ok: false, reason: 'personal-sender' };
	}

	// Checked first: an OTP message routinely quotes the amount it is for.
	if (OTP.test(text)) return { ok: false, reason: 'otp' };
	if (PROMO.test(text)) return { ok: false, reason: 'promo' };
	if (FAILED.test(text)) return { ok: false, reason: 'failed' };
	if (FUTURE_OR_REQUEST.test(text)) return { ok: false, reason: 'future-or-request' };

	if (!TRANSACTION_VERB.test(text)) {
		return { ok: false, reason: BALANCE.test(text) ? 'balance-only' : 'not-transactional' };
	}
	if (parseAmount(text) === null) return { ok: false, reason: 'no-amount' };

	return { ok: true };
}
