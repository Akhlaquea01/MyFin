import { useRegisterSW } from 'virtual:pwa-register/react';

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Wraps vite-plugin-pwa's `useRegisterSW` (registerType: 'prompt' — see vite.config.ts) so a
 * new version never applies itself: the user leaves this PWA open/installed for long stretches,
 * and an unannounced reload could interrupt an in-progress transaction/budget form.
 */
export function useAppUpdate() {
	const {
		needRefresh: [needRefresh, setNeedRefresh],
		updateServiceWorker
	} = useRegisterSW({
		onRegisteredSW(_url, registration) {
			if (!registration) return;
			void registration.update();
			setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS);
		},
		onRegisterError(error) {
			console.error('[useAppUpdate] service worker registration failed', error);
		}
	});

	return {
		needRefresh,
		updateNow: () => updateServiceWorker(true),
		dismiss: () => setNeedRefresh(false)
	};
}
