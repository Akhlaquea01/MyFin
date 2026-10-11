import type { TransactionLink } from '../../data/dexie/transactionRepository';

export interface LinkedTransactionNotice {
	/** Why this entry can't be changed on its own, and what to do instead. */
	message: string;
	/** The page that owns the record the entry belongs to. */
	to: string;
	linkLabel: string;
	/** Short noun phrase for "This transaction is linked to a …". */
	subject: string;
}

/**
 * Wording for a ledger entry that is the other half of a record elsewhere (a person loan or its
 * repayment, or a payment toward a liability). One place, so the delete guard, the edit dialog,
 * the transfer conversion and the permanent-delete guard all send the user to the same page with
 * the same explanation.
 */
export function linkedTransactionNotice(link: TransactionLink): LinkedTransactionNotice {
	if (link.kind === 'liability-payment') {
		return {
			message:
				'This entry is a payment toward a loan or card on the Liabilities page, so it is managed there. Use "Undo" on that payment to reverse it.',
			to: '/liabilities',
			linkLabel: 'Go to Liabilities',
			subject: 'liability payment'
		};
	}
	return {
		message:
			'This entry records a loan or repayment, so it is managed from the People page. Use "Remove loan" or "Undo" there.',
		to: '/people',
		linkLabel: 'Go to People',
		subject: 'person loan or repayment'
	};
}
