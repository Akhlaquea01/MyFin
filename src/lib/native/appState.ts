import { isNativeApp } from './platform';

/**
 * Calls `onChange(true)` whenever the app comes to the foreground and `onChange(false)` when it
 * goes to the background. Uses the Capacitor app-state event in the Android app (reliable even
 * when the WebView is frozen) and `visibilitychange` everywhere else. Returns an unsubscribe
 * function that is safe to call before the native listener has finished registering.
 */
export function subscribeAppActive(onChange: (isActive: boolean) => void): () => void {
	const onVisibility = () => onChange(document.visibilityState === 'visible');
	document.addEventListener('visibilitychange', onVisibility);

	let removed = false;
	let removeNative: (() => void) | null = null;
	if (isNativeApp()) {
		void import('@capacitor/app')
			.then(({ App }) => App.addListener('appStateChange', (state) => onChange(state.isActive)))
			.then((handle) => {
				if (removed) void handle.remove();
				else removeNative = () => void handle.remove();
			})
			.catch(() => {
				// visibilitychange above still covers the common cases.
			});
	}

	return () => {
		removed = true;
		document.removeEventListener('visibilitychange', onVisibility);
		removeNative?.();
	};
}
