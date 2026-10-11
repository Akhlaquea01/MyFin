import type { Transaction } from '../entities';

/**
 * The text a transaction came from, for the places that read it for hints (card-payment
 * detection, matching a card by its digits). Entries typed or pasted in keep it in `notes`;
 * captured ones keep it in `capture.text` so it does not become the row title.
 */
export function originalMessageOf(tx: Pick<Transaction, 'notes' | 'capture'>): string {
	return tx.notes ?? tx.capture?.text ?? '';
}
