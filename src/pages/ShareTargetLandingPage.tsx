import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { readAndClearSharedPayload } from '../lib/shareTarget';

// Spec 008, User Stories 1 & 2: a pure redirect landing route reached only via the
// share_target service worker's 303 redirect (public/sw-share-target.js) — reads the
// stashed payload once and forwards the user into the appropriate existing screen with it
// pre-loaded. A shared file takes priority over shared text per FR-004 (contracts/
// share-target.md) — a share carrying both (e.g. an image with a caption) still routes to
// the new-transaction screen, since that's the richer destination.
export function ShareTargetLandingPage() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();

	useEffect(() => {
		const id = searchParams.get('id');
		if (!id) {
			navigate('/quick-add', { replace: true });
			return;
		}

		void readAndClearSharedPayload(id).then(({ sharedText, file }) => {
			if (file) {
				navigate('/transactions/new', { replace: true, state: { sharedFile: file } });
			} else if (sharedText) {
				navigate('/quick-add', { replace: true, state: { sharedText } });
			} else {
				toast.error("Couldn't retrieve the shared content.");
				navigate('/quick-add', { replace: true });
			}
		});
		// Runs once per landing — the `id` identifies a single, one-time-consumable share.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	return <div className="min-h-dvh bg-background" />;
}
