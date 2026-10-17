import type { CaptureChannel, EpochMillis, ISODateString } from '../entities';

/** A message handed over by the Android app, after it was opened with the sealing key. */
export interface CapturePayload {
	channel: CaptureChannel;
	/** SMS sender id, or the name/package of the app that posted the notification. */
	sender: string;
	/** Notification title; SMS have none. */
	title?: string | null;
	body: string;
	receivedAt: EpochMillis;
}

/** The text a message is judged and parsed on: title and body together. */
export function messageText(p: Pick<CapturePayload, 'title' | 'body'>): string {
	return [p.title, p.body]
		.filter((part): part is string => !!part && part.trim() !== '')
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export type IgnoreReason =
	| 'otp'
	| 'promo'
	| 'not-transactional'
	| 'failed'
	| 'future-or-request'
	| 'balance-only'
	| 'personal-sender'
	| 'too-long'
	| 'no-amount';

export type ClassifyResult = { ok: true } | { ok: false; reason: IgnoreReason };

/** What the message says the money moved through, when it says. `credit_card` is the one that
 *  matters: it decides which account the entry belongs to and how a missing verb is read. */
export type CaptureInstrument = 'credit_card' | 'debit_card' | 'upi' | 'account';

export interface ParsedCapture {
	/** Unsigned minor units (paise). */
	amount: number;
	type: 'income' | 'expense';
	/** The counterparty as written in the message; normalised when the merchant is resolved. */
	merchantText: string | null;
	/** Digits after "A/c XX…" (3–4 digits, the last four of the account number). */
	accountTail: string | null;
	/** Digits after "card ending …". */
	cardTail: string | null;
	/** A date written in the message, if one could be read. */
	txnDate: ISODateString | null;
	/** A time of day written in the message, 24-hour "HH:mm", if one could be read. */
	txnTime: string | null;
	refNo: string | null;
	/** The message describes paying a credit card bill, which is a transfer rather than spending. */
	isCardPayment: boolean;
	/** "Credit Card", "Debit Card", UPI or a bank account, as the message words it; null when it
	 *  does not say (a bare "Card XX1234" could be either kind). */
	instrument: CaptureInstrument | null;
	/** The direction was assumed (no debit/credit verb) because the message is about a credit card. */
	directionGuessed: boolean;
}
