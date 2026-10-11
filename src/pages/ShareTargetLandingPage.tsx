import { useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
	readAndClearSharedPayload,
	resolveShareDestination,
	type SharedPayload
} from '../lib/shareTarget';

// Spec 008, User Stories 1 & 2: a pure redirect landing route reached only via the
// share_target service worker's 303 redirect (public/sw-share-target.js) — reads the
// stashed payload once and forwards the user into the appropriate existing screen with it
// pre-loaded. A shared file takes priority over shared text per FR-004 (contracts/
// share-target.md) — a share carrying both (e.g. an image with a caption) still routes to
// the new-transaction screen, since that's the richer destination.
//
// In the Android app there is no service worker: NativeShareBridge takes the share from the
// native side and arrives here with it in the router state (`nativePayload`). Going through this
// route — rather than straight to the destination — also means the destination always mounts
// fresh, even when the user is already on it.
export function ShareTargetLandingPage() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const location = useLocation();

	useEffect(() => {
		function forward(payload: SharedPayload) {
			const destination = resolveShareDestination(payload);
			if (destination) {
				navigate(destination.to, { replace: true, state: destination.state });
			} else {
				toast.error("Couldn't retrieve the shared content.");
				navigate('/quick-add', { replace: true });
			}
		}

		const nativePayload = (location.state as { nativePayload?: SharedPayload } | null)
			?.nativePayload;
		if (nativePayload) {
			forward(nativePayload);
			return;
		}

		const id = searchParams.get('id');
		if (!id) {
			navigate('/quick-add', { replace: true });
			return;
		}

		void readAndClearSharedPayload(id).then(forward);
		// Runs once per landing — the `id` identifies a single, one-time-consumable share.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return <div className="min-h-dvh bg-background" />;
}
