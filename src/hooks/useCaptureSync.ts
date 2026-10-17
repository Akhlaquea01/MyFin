import { useEffect } from 'react';
import { toast } from 'sonner';
import {
	drainCapturedTransactions,
	REVIEW_CHANGED_EVENT,
	type DrainResult
} from '../data/io/captureDrain';
import {
	TransactionCapture,
	isTransactionCaptureAvailable
} from '../lib/native/transactionCapture';
import { subscribeAppActive } from '../lib/native/appState';

function announce(result: DrainResult): void {
	const { created, paired, noAccount } = result.report;
	// Messages that were read but have no account to go to are kept in the Auto-capture page and tried
	// again each run, and nothing else says so: the default account was deleted or archived, or never
	// chosen. A stable id keeps repeated runs from stacking the same toast.
	if (noAccount > 0) {
		toast.warning(
			noAccount === 1
				? '1 bank message is waiting for an account: none matches it and there is no default account.'
				: `${noAccount} bank messages are waiting for an account: none matches them and there is no default account.`,
			{
				id: 'capture-no-account',
				action: {
					label: 'Fix',
					onClick: () => {
						window.history.pushState(null, '', '/auto-capture');
						window.dispatchEvent(new PopStateEvent('popstate'));
					}
				}
			}
		);
	}
	if (created === 0 && paired === 0) return;
	if (created > 0) {
		toast.success(
			created === 1
				? '1 new transaction added to Review'
				: `${created} new transactions added to Review`,
			{
				action: {
					label: 'Review',
					// Outside React, so no router hook: push the route and let BrowserRouter hear the popstate.
					onClick: () => {
						window.history.pushState(null, '', '/review');
						window.dispatchEvent(new PopStateEvent('popstate'));
					}
				}
			}
		);
	}
	window.dispatchEvent(new Event(REVIEW_CHANGED_EVENT));
}

/**
 * Files whatever the Android app captured while it was closed or locked, and tells the user (and
 * an open Review page) when something new landed. Never throws: capture is a convenience, and a
 * failure here must not get in the way of unlocking or using the app.
 */
export async function syncCapturedTransactions(key: CryptoKey): Promise<void> {
	try {
		const result = await drainCapturedTransactions(key);
		if (result) announce(result);
	} catch {
		// Deliberately silent and unlogged: an error here could carry message text.
	}
}

/**
 * Keeps capture flowing while the app is open and unlocked: drains when the app returns to the
 * foreground and when native reports a new message. (The unlock itself is covered by
 * `afterUnlock` in App.tsx.)
 */
export function useCaptureSync(unlocked: boolean, getKey: () => CryptoKey): void {
	useEffect(() => {
		if (!unlocked || !isTransactionCaptureAvailable()) return;

		const sync = () => {
			try {
				void syncCapturedTransactions(getKey());
			} catch {
				// Locked in the meantime.
			}
		};
		const stopActive = subscribeAppActive((active) => {
			if (active) sync();
		});

		let debounce: ReturnType<typeof setTimeout> | undefined;
		let removed = false;
		let removeListener: (() => void) | null = null;
		void TransactionCapture.onCaptured(() => {
			clearTimeout(debounce);
			debounce = setTimeout(sync, 1000);
		})
			.then((handle) => {
				if (removed) void handle.remove();
				else removeListener = () => void handle.remove();
			})
			.catch(() => {});

		return () => {
			removed = true;
			clearTimeout(debounce);
			stopActive();
			removeListener?.();
		};
	}, [unlocked, getKey]);
}
