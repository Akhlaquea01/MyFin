import { useEffect, useState } from 'react';
import { NotificationInboxRepository } from '../data/dexie/notificationInboxRepository';
import { ALERTS_CHANGED_EVENT } from '../lib/alertsEvent';

/** How many alerts are unread, kept current as the unlock-time check and the Alerts page change
 *  them. Counted off an indexed column, so it never decrypts anything. */
export function useUnreadAlerts(): number {
	const [count, setCount] = useState(0);

	useEffect(() => {
		let cancelled = false;
		const refresh = () => {
			void NotificationInboxRepository.countUnread()
				.then((n) => {
					if (!cancelled) setCount(n);
				})
				.catch(() => {
					// A badge is never worth an error.
				});
		};
		refresh();
		window.addEventListener(ALERTS_CHANGED_EVENT, refresh);
		return () => {
			cancelled = true;
			window.removeEventListener(ALERTS_CHANGED_EVENT, refresh);
		};
	}, []);

	return count;
}
