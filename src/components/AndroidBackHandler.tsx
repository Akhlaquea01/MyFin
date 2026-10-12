import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isNativeApp } from '../lib/native/platform';

/** Open Radix dialogs, sheets and alert dialogs all carry `data-state="open"`. */
const OPEN_OVERLAY_SELECTOR =
	'[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

/**
 * Makes the Android Back button behave like a phone app's: first close whatever overlay is open
 * (the navigation drawer, a dialog), then go back through the app's own history, and from the
 * Dashboard leave the app. Without this Back ignores overlays — they push no history — so it
 * navigates away from the page behind a dialog, or exits the app outright.
 * Renders nothing and does nothing outside the Android app.
 */
export function AndroidBackHandler() {
	const navigate = useNavigate();
	const location = useLocation();

	useEffect(() => {
		if (!isNativeApp()) return;

		let removed = false;
		let removeListener: (() => void) | null = null;
		void import('@capacitor/app')
			.then(({ App }) =>
				App.addListener('backButton', ({ canGoBack }) => {
					if (document.querySelector(OPEN_OVERLAY_SELECTOR)) {
						// Radix listens for Escape on the document and runs its normal close path.
						document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
						return;
					}
					if (canGoBack) {
						window.history.back();
					} else if (location.pathname !== '/') {
						navigate('/', { replace: true });
					} else {
						void App.exitApp();
					}
				})
			)
			.then((handle) => {
				if (removed) void handle.remove();
				else removeListener = () => void handle.remove();
			})
			.catch(() => {
				// Without the plugin Android falls back to its default Back behaviour.
			});

		return () => {
			removed = true;
			removeListener?.();
		};
	}, [navigate, location.pathname]);

	return null;
}
