import type { CaptureChannel, EpochMillis, Transaction } from '../entities';

/** How far apart (in time) an SMS and a payment-app notification may arrive and still be the
 *  same payment. */
export const PAIRING_WINDOW_MS = 10 * 60 * 1000;

/**
 * One payment often produces two alerts — the bank's SMS and the payment app's notification.
 * Returns the waiting captured entry the new message is a second sighting of, or null if it is a
 * payment of its own.
 *
 * Deliberately narrow, because folding two messages into one hides a transaction: the other
 * channel only, the same signed amount, within `windowMs`, and one-to-one — an entry that already
 * absorbed a second sighting is never paired again, so two same-amount payments a few minutes
 * apart (each alerted on both channels) stay two entries. The account is ignored on purpose: the
 * notification carries no account digits, so it lands on the default account while the SMS names
 * the real one.
 */
export function findPairedCapture(
	incoming: { channel: CaptureChannel; receivedAt: EpochMillis },
	signedAmount: number,
	waiting: Transaction[],
	windowMs: number = PAIRING_WINDOW_MS
): Transaction | null {
	let best: { tx: Transaction; gap: number } | null = null;
	for (const tx of waiting) {
		const capture = tx.capture;
		if (!capture) continue;
		if (tx.reviewStatus !== 'unreviewed') continue;
		if (capture.channel === incoming.channel) continue;
		if (tx.amount !== signedAmount) continue;
		if (capture.alsoSeenAs && capture.alsoSeenAs.length > 0) continue;
		const gap = Math.abs(capture.receivedAt - incoming.receivedAt);
		if (gap > windowMs) continue;
		if (best === null || gap < best.gap) best = { tx, gap };
	}
	return best?.tx ?? null;
}
