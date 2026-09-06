import { useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { Button } from './ui/button';
import { isWebAuthnSupported, enrollBiometric, type BiometricUnavailableReason } from '../lib/webauthn';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';

/** One sentence per BiometricUnavailableReason (spec 009) — the whole point of moving off a
 *  single flat "unsupported" notice was so the user can tell a hardware/browser gap apart
 *  from a prompt they just dismissed and could simply retry. */
const UNAVAILABLE_MESSAGES: Record<BiometricUnavailableReason, string> = {
	unsupported: "This browser doesn't support WebAuthn biometric unlock. You can keep using your PIN.",
	cancelled: 'Biometric setup was cancelled.',
	'no-prf':
		"Your device's fingerprint sensor doesn't support the secure key derivation (PRF) this app " +
		'requires for biometric unlock — this is a hardware/browser limitation, not a bug. You can ' +
		'keep using your PIN.',
	'prf-eval-failed':
		'Your fingerprint sensor reported support for secure key derivation but the verification step ' +
		"failed. You can retry, or keep using your PIN if it doesn't work.",
	error: 'Something went wrong enabling biometric unlock. You can retry, or keep using your PIN.'
};

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
	const [unavailableReason, setUnavailableReason] = useState<BiometricUnavailableReason | null>(null);

	const visible = !dismissed && isWebAuthnSupported() && !alreadyEnrolled;
	if (!visible) return null;

	async function handleEnable() {
		setEnrolling(true);
		setUnavailableReason(null);
		try {
			const result = await enrollBiometric(pin);
			if (!result.ok) {
				setUnavailableReason(result.reason);
				return;
			}
			await UserProfileRepository.update({ biometricEnabled: true, webauthn: result.enrollment });
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

	const canRetry = unavailableReason === 'cancelled' || unavailableReason === 'prf-eval-failed' || unavailableReason === 'error';

	return (
		<div className="border-b bg-muted/40 px-4 py-3">
			{unavailableReason ? (
				<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
					<p>{UNAVAILABLE_MESSAGES[unavailableReason]}</p>
					<div className="ml-auto flex gap-2">
						{canRetry && (
							<Button size="sm" variant="outline" disabled={enrolling} onClick={handleEnable}>
								{enrolling ? 'Retrying…' : 'Retry'}
							</Button>
						)}
						<Button variant="link" size="sm" className="h-auto p-0" onClick={handleSkip}>
							Close
						</Button>
					</div>
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
