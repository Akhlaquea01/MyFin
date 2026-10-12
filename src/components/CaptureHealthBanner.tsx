import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { useAppActive } from '../hooks/useAppActive';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';
import {
	TransactionCapture,
	isTransactionCaptureAvailable
} from '../lib/native/transactionCapture';

/**
 * Auto-capture can be switched on in the profile while Android no longer lets it work — a
 * permission revoked, notification access turned off, or a backup restored onto a phone that
 * never granted them. Nothing is captured then, and the only place that shows it is the
 * Auto-capture page. This says so wherever the user is. Android app only.
 */
export function CaptureHealthBanner() {
	const { activationCount } = useAppActive();
	const location = useLocation();
	const [problem, setProblem] = useState<string | null>(null);

	useEffect(() => {
		if (!isTransactionCaptureAvailable()) return;
		let cancelled = false;
		void (async () => {
			const capture = (await UserProfileRepository.get())?.capture;
			if (!capture?.enabled) {
				if (!cancelled) setProblem(null);
				return;
			}
			const status = await TransactionCapture.getStatus();
			const missing: string[] = [];
			if (capture.sms && status.sms !== 'granted') missing.push('permission to read SMS');
			if (capture.notifications && !status.notificationListenerEnabled) {
				missing.push('notification access');
			}
			if (!cancelled) setProblem(missing.length > 0 ? missing.join(' and ') : null);
		})().catch(() => {
			// Unknown is not a reason to alarm the user.
		});
		return () => {
			cancelled = true;
		};
		// Re-checked on every return to the app and every page change, so fixing it in Android
		// settings (or on the Auto-capture page) clears the banner.
	}, [activationCount, location.pathname]);

	if (!problem || location.pathname === '/auto-capture') return null;

	return (
		<div
			role="alert"
			className="flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
		>
			<TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<p className="flex-1">
				Auto-capture is on but MyFin has lost {problem}, so new bank messages are not being added.
			</p>
			<Link to="/auto-capture" className="font-medium underline underline-offset-2">
				Fix
			</Link>
		</div>
	);
}
