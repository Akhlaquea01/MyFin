import type { CaptureChannel, EpochMillis, ID, Transaction } from '../entities';

/** How far apart (in time) an SMS and a payment-app notification may arrive and still be the
 *  same payment. */
export const PAIRING_WINDOW_MS = 10 * 60 * 1000;

/** A bank reference number identifies one payment, so two messages carrying the same one are the
 *  same payment however late the second arrives (a delayed or re-posted copy). */
export const REFERENCE_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;

export interface IncomingSighting {
	channel: CaptureChannel;
	receivedAt: EpochMillis;
	refNo?: string | null;
	/** Set only when the message's own digits named the account — never for a default guess. */
	exactAccountId?: ID | null;
}

/**
 * One payment often produces two alerts — the bank's SMS and the payment app's notification.
 * Returns the captured entry the new message is another sighting of, or null if it is a payment
 * of its own.
 *
 * Deliberately narrow, because folding two messages into one hides a transaction. Without a
 * reference number: the other channel only, the same signed amount, within `windowMs`, and
 * one-to-one — an entry that already absorbed a second sighting is never paired again, so two
 * same-amount payments a few minutes apart (each alerted on both channels) stay two entries. The
 * account is ignored on purpose: the notification carries no account digits, so it lands on the
 * default account while the SMS names the real one.
 *
 * Two things settle it either way: the same reference number is the same payment (any channel,
 * up to `REFERENCE_WINDOW_MS`), and two different reference numbers, or two different accounts
 * that both came from the message's own digits, never are.
 */
export function findPairedCapture(
	incoming: IncomingSighting,
	signedAmount: number,
	waiting: Transaction[],
	windowMs: number = PAIRING_WINDOW_MS
): Transaction | null {
	let best: { tx: Transaction; gap: number } | null = null;
	for (const tx of waiting) {
		const capture = tx.capture;
		if (!capture) continue;
		if (tx.amount !== signedAmount) continue;
		const gap = Math.abs(capture.receivedAt - incoming.receivedAt);

		if (incoming.refNo && capture.refNo) {
			if (incoming.refNo !== capture.refNo) continue;
			if (gap > REFERENCE_WINDOW_MS) continue;
		} else {
			if (tx.reviewStatus !== 'unreviewed') continue;
			if (capture.channel === incoming.channel) continue;
			if (capture.alsoSeenAs && capture.alsoSeenAs.length > 0) continue;
			if (gap > windowMs) continue;
		}

		const entryAccountIsExact = !capture.accountCheck;
		if (
			entryAccountIsExact &&
			incoming.exactAccountId &&
			incoming.exactAccountId !== tx.accountId
		) {
			continue;
		}
		if (best === null || gap < best.gap) best = { tx, gap };
	}
	return best?.tx ?? null;
}
