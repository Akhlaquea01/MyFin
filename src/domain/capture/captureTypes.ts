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
	refNo: string | null;
	/** The message describes paying a credit card bill, which is a transfer rather than spending. */
	isCardPayment: boolean;
}
