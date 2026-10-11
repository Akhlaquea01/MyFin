import type { Merchant, Transaction } from '../entities';

// spec 018, User Story 3 (FR-012/FR-013/FR-014): the one shared label rule for every screen that
// lists transactions. `tx.type` is deliberately never read — type stays conveyed by amount
// sign/color, as it already is today. See contracts/transaction-label.md.
export function formatTransactionLabel(
	tx: Pick<Transaction, 'notes' | 'merchantId'> & Partial<Pick<Transaction, 'capture'>>,
	merchants: Merchant[]
): string {
	if (tx.notes) return tx.notes;
	const merchant = tx.merchantId ? merchants.find((m) => m.id === tx.merchantId) : undefined;
	if (merchant) return merchant.name;
	// A captured message that named no merchant is still better described by where it came from
	// than as "Unlabeled transaction".
	if (tx.capture) {
		return tx.capture.channel === 'sms'
			? `Bank SMS · ${tx.capture.sender}`
			: `Notification · ${tx.capture.sender}`;
	}
	return 'Unlabeled transaction';
}
