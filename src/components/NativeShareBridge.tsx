import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
	consumeNativeShare,
	isNativeShareAvailable,
	onNativeShare
} from '../lib/native/nativeShare';
import { subscribeAppActive } from '../lib/native/appState';
import { resolveShareDestination, sharedPayloadFromNative } from '../lib/shareTarget';
import { hasUnsavedChanges } from '../lib/unsavedChanges';
import { useConfirm } from '../lib/confirm';

/**
 * Carries what other Android apps share into MyFin to the share landing route, which forwards it
 * to Quick Add (text) or New Transaction (image) exactly as the PWA's share target does. Rendered
 * only inside the unlocked app, so a share made while the app is locked just waits natively and is
 * picked up on mount right after unlock. Renders nothing, and does nothing outside the Android app.
 */
export function NativeShareBridge() {
	const navigate = useNavigate();
	const confirm = useConfirm();
	// `navigate` changes identity whenever the location does; the subscriptions below must not.
	const navigateRef = useRef(navigate);
	const confirmRef = useRef(confirm);
	useEffect(() => {
		navigateRef.current = navigate;
		confirmRef.current = confirm;
	});

	useEffect(() => {
		if (!isNativeShareAvailable()) return;

		let busy = false;
		const take = async () => {
			if (busy) return;
			busy = true;
			try {
				const shared = await consumeNativeShare();
				if (!shared) return;
				if (shared.imageProblem) {
					toast.error(
						shared.imageProblem === 'too-large'
							? 'That image is too large to attach.'
							: "Couldn't read the shared image."
					);
				}
				if (shared.fileProblem) {
					toast.error(
						shared.fileProblem === 'too-large'
							? 'That file is too large to import.'
							: "Couldn't read the shared file."
					);
				}
				const payload = sharedPayloadFromNative(shared);
				if (!resolveShareDestination(payload)) return;
				const open = () =>
					navigateRef.current('/share-target-landing', { state: { nativePayload: payload } });
				// Opening the shared content replaces the screen — and anything half-typed on it.
				if (hasUnsavedChanges()) {
					const replace = await confirmRef.current({
						title: 'Open the shared content?',
						message: 'You have something half-filled in. Opening what was shared will replace it.',
						confirmLabel: 'Open shared content',
						cancelLabel: 'Keep what I was typing'
					});
					if (!replace) {
						toast.info('The shared content was not opened.', {
							action: { label: 'Open it', onClick: open }
						});
						return;
					}
				}
				open();
			} catch {
				// Nothing to hand over, or the plugin is unavailable: sharing is a convenience.
			} finally {
				busy = false;
			}
		};

		void take();
		const stopActive = subscribeAppActive((active) => {
			if (active) void take();
		});

		let removed = false;
		let removeListener: (() => void) | null = null;
		void onNativeShare(() => void take())
			.then((handle) => {
				if (removed) void handle.remove();
				else removeListener = () => void handle.remove();
			})
			.catch(() => {});

		return () => {
			removed = true;
			stopActive();
			removeListener?.();
		};
	}, []);

	return null;
}
