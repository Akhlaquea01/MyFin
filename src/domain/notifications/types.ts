/**
 * Recurring & Budget Notifications domain types (spec 004). A NotificationCandidate is
 * always derived on demand — never persisted (only its dedupe key survives, as a
 * NotifiedItem, once actually dispatched — see data-model.md).
 */

export type NotificationCandidateKind = 'recurring' | 'budget' | 'personLoan';

export interface NotificationCandidate {
	kind: NotificationCandidateKind;
	/** Dedupe key: `recurring:{expectedEventId}`, `budget:{budgetId}:{periodStart}:{thresholdPercent}`,
	 *  or `personLoan:{loanId}:overdue` (spec 010). */
	key: string;
	title: string;
	body: string;
}
