import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { onNotificationTapped } from '../lib/notify';

/**
 * Opens the screen a tapped MyFin notification is about (the bill, the budget, the loan, the
 * backup page) instead of leaving the user on whatever was open. Android app only; renders
 * nothing. Mounted inside the unlocked app, so a tap while locked lands on the lock screen first.
 */
export function NotificationTapHandler() {
	const navigate = useNavigate();
	// `navigate` changes identity with the location; the native subscription must not.
	const navigateRef = useRef(navigate);
	useEffect(() => {
		navigateRef.current = navigate;
	});

	useEffect(() => {
		let stopped = false;
		let stop: (() => void) | null = null;
		void onNotificationTapped((route) => navigateRef.current(route)).then((remove) => {
			if (stopped) remove();
			else stop = remove;
		});
		return () => {
			stopped = true;
			stop?.();
		};
	}, []);

	return null;
}
