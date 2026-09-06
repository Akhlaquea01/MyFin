import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from './ui/button';
import { useSession } from '../context/SessionContext';
import { NotificationPreferenceRepository } from '../data/dexie/notificationRepository';

// FR-001: request notification permission, with an explanation, before first attempting to
// show one. Shown once (mirrors BiometricEnrollmentPrompt.tsx's structure) — dismissing
// either way persists so it never nags again, regardless of the permission outcome.
export function NotificationPermissionPrompt() {
	const { getEncryptionKey } = useSession();
	const [loaded, setLoaded] = useState(false);
	const [permissionPromptDismissed, setPermissionPromptDismissed] = useState(true);
	const [dismissedThisSession, setDismissedThisSession] = useState(false);
	const [requesting, setRequesting] = useState(false);

	useEffect(() => {
		void NotificationPreferenceRepository.get(getEncryptionKey()).then((pref) => {
			setPermissionPromptDismissed(pref.permissionPromptDismissed);
			setLoaded(true);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const supported = typeof Notification !== 'undefined';
	const visible =
		loaded &&
		!dismissedThisSession &&
		supported &&
		Notification.permission === 'default' &&
		!permissionPromptDismissed;
	if (!visible) return null;

	async function persistDismissed() {
		await NotificationPreferenceRepository.save(getEncryptionKey(), {
			permissionPromptDismissed: true
		});
		setDismissedThisSession(true);
	}

	async function handleEnable() {
		setRequesting(true);
		try {
			await Notification.requestPermission();
		} finally {
			setRequesting(false);
		}
		await persistDismissed();
	}

	return (
		<div className="border-b bg-muted/40 px-4 py-3">
			<div className="flex flex-wrap items-center gap-3">
				<Bell className="size-4 text-primary" />
				<p className="text-sm">Enable notifications for bill reminders and budget alerts?</p>
				<div className="ml-auto flex gap-2">
					<Button size="sm" disabled={requesting} onClick={handleEnable}>
						{requesting ? 'Enabling…' : 'Enable'}
					</Button>
					<Button size="sm" variant="ghost" onClick={() => void persistDismissed()}>
						Not now
					</Button>
				</div>
			</div>
		</div>
	);
}
