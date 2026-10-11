import { useEffect, useRef, useState } from 'react';
import { subscribeAppActive } from '../lib/native/appState';

/**
 * Whether the app is in the foreground, plus a counter that goes up each time it returns to the
 * foreground. Effects that should happen once per return (like offering the fingerprint prompt)
 * key off the counter rather than the component mounting, because a screen can mount while the
 * app is still in the background.
 */
export function useAppActive(): { isActive: boolean; activationCount: number } {
	const [isActive, setIsActive] = useState(() => document.visibilityState !== 'hidden');
	const [activationCount, setActivationCount] = useState(0);
	const activeRef = useRef(document.visibilityState !== 'hidden');

	useEffect(
		() =>
			subscribeAppActive((active) => {
				// The Android app reports a return to the foreground through both the Capacitor
				// event and visibilitychange; only the first of the two is a real transition.
				if (active === activeRef.current) return;
				activeRef.current = active;
				setIsActive(active);
				if (active) setActivationCount((n) => n + 1);
			}),
		[]
	);

	return { isActive, activationCount };
}
