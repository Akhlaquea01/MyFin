import type { ReviewStatus } from '../entities';

/**
 * Whether saving an edit to a transaction should also feed the merchant→category learning.
 *
 * A category chosen by hand on a confirmed entry is the strongest learning signal there is, so the
 * edit records it. An entry still waiting in Review has not been confirmed yet: Confirm records the
 * choice itself, and recording it on Save as well would count one decision twice (and let a single
 * tweak-then-confirm cement a suggestion). So edits to unreviewed entries never learn.
 */
export function shouldLearnFromEdit(input: {
	reviewStatus: ReviewStatus;
	isSplit: boolean;
	categoryChanged: boolean;
	categoryId: string;
	uncategorizedId: string;
	hasMerchant: boolean;
}): boolean {
	if (input.reviewStatus === 'unreviewed') return false;
	return (
		!input.isSplit &&
		input.categoryChanged &&
		input.categoryId !== input.uncategorizedId &&
		input.hasMerchant
	);
}
