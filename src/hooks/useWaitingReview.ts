import { useEffect, useState } from 'react';
import { TransactionRepository } from '../data/dexie/transactionRepository';
import { REVIEW_CHANGED_EVENT } from '../data/io/captureDrain';

/** How many entries wait in Review, for the tab badge. Counted off an indexed column, so nothing is
 *  decrypted. `refreshKey` (the current route) recounts after the queue was worked on elsewhere. */
export function useWaitingReview(refreshKey: string): number {
	const [count, setCount] = useState(0);

	useEffect(() => {
		let cancelled = false;
		const refresh = () => {
			void TransactionRepository.countUnreviewed()
				.then((n) => {
					if (!cancelled) setCount(n);
				})
				.catch(() => {
					// A badge is never worth an error.
				});
		};
		refresh();
		window.addEventListener(REVIEW_CHANGED_EVENT, refresh);
		return () => {
			cancelled = true;
			window.removeEventListener(REVIEW_CHANGED_EVENT, refresh);
		};
	}, [refreshKey]);

	return count;
}
