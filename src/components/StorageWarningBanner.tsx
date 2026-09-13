import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from './ui/button';

const DISMISSED_UNTIL_KEY = 'STORAGE_WARNING_DISMISSED_UNTIL';
/** Re-surfaces after a week rather than being silenced forever — the underlying risk (data
 *  can be silently evicted) doesn't go away just because the user dismissed the notice once. */
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

function isCurrentlyDismissed(): boolean {
	const raw = localStorage.getItem(DISMISSED_UNTIL_KEY);
	if (!raw) return false;
	const until = Number(raw);
	return Number.isFinite(until) && Date.now() < until;
}

// FR-044 / Edge Case: shown when the browser denied or doesn't support the app's request
// for durable storage — data is at higher risk of silent eviction under storage pressure
// (most notably on Safari, which doesn't support the API).
export function StorageWarningBanner() {
	const [dismissed, setDismissed] = useState(isCurrentlyDismissed);

	function handleDismiss() {
		localStorage.setItem(DISMISSED_UNTIL_KEY, String(Date.now() + DISMISS_DURATION_MS));
		setDismissed(true);
	}

	if (dismissed) return null;

	return (
		<div
			role="alert"
			className="flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
		>
			<TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<p className="flex-1">
				Your browser couldn't guarantee protected storage for this app. Your data may be deleted
				automatically if the device runs low on space. Back up regularly from Settings.
			</p>
			<Button variant="link" size="sm" className="h-auto p-0" onClick={handleDismiss}>
				Dismiss
			</Button>
		</div>
	);
}
