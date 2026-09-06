import { useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { Button } from './ui/button';
import { isWebAuthnSupported, enrollBiometric } from '../lib/webauthn';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';

// Acceptance Scenario 4 (US1): offered once, right after the user is unlocked, on any
// device that supports it. Declining just dismisses it — the PIN keeps working exactly
// as before, since it's the mandatory fallback regardless (spec.md Assumptions).
export function BiometricEnrollmentPrompt({
	pin,
	alreadyEnrolled,
	onDone
}: {
	pin: string;
	alreadyEnrolled: boolean;
	onDone: () => void;
}) {
	const [dismissed, setDismissed] = useState(false);
	const [enrolling, setEnrolling] = useState(false);
	const [unsupportedNotice, setUnsupportedNotice] = useState(false);

	const visible = !dismissed && isWebAuthnSupported() && !alreadyEnrolled;
	if (!visible) return null;

	async function handleEnable() {
		setEnrolling(true);
		try {
			const enrollment = await enrollBiometric(pin);
			if (!enrollment) {
				setUnsupportedNotice(true);
				return;
			}
			await UserProfileRepository.update({ biometricEnabled: true, webauthn: enrollment });
			setDismissed(true);
			onDone();
		} finally {
			setEnrolling(false);
		}
	}

	function handleSkip() {
		setDismissed(true);
		onDone();
	}

	return (
		<div className="border-b bg-muted/40 px-4 py-3">
			{unsupportedNotice ? (
				<div className="flex items-center gap-3 text-sm text-muted-foreground">
					<p>
						Biometric unlock isn't available on this device/browser. You can keep using your PIN.
					</p>
					<Button variant="link" size="sm" className="h-auto p-0" onClick={handleSkip}>
						Close
					</Button>
				</div>
			) : (
				<div className="flex flex-wrap items-center gap-3">
					<Fingerprint className="size-4 text-primary" />
					<p className="text-sm">Enable biometric unlock for faster access next time?</p>
					<div className="ml-auto flex gap-2">
						<Button size="sm" disabled={enrolling} onClick={handleEnable}>
							{enrolling ? 'Enabling…' : 'Enable'}
						</Button>
						<Button size="sm" variant="ghost" onClick={handleSkip}>
							Not now
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
