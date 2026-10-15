import { useSyncExternalStore } from 'react';

/** Phones and small tablets: the same breakpoint the app shell switches its layout on. */
export const MOBILE_QUERY = '(max-width: 767px)';

/** Whether `query` currently matches, following changes (rotation, window resize). */
export function useMediaQuery(query: string): boolean {
	return useSyncExternalStore(
		(onChange) => {
			const list = window.matchMedia(query);
			list.addEventListener('change', onChange);
			return () => list.removeEventListener('change', onChange);
		},
		() => window.matchMedia(query).matches,
		() => false
	);
}
