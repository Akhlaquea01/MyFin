/**
 * Recurring & Budget Notifications domain types (spec 004). A NotificationCandidate is
 * always derived on demand — never persisted (only its dedupe key survives, as a
 * NotifiedItem, once actually dispatched — see data-model.md).
 */

export type NotificationCandidateKind = 'recurring' | 'budget';

export interface NotificationCandidate {
	kind: NotificationCandidateKind;
	/** Dedupe key: `recurring:{expectedEventId}` or `budget:{budgetId}:{periodStart}:{thresholdPercent}`. */
	key: string;
	title: string;
	body: string;
}
