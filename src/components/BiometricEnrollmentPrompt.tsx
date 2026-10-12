import { useCallback, useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { Button } from './ui/button';
import {
	describeBiometricReason,
	enrollBiometricUnlock,
	getBiometricAvailability,
	type BiometricAvailability,
	type BiometricReason
} from '../lib/biometric';
import type { PendingBiometricEnrollment } from '../lib/webauthn';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';
import { snoozeBiometricPrompt } from '../lib/biometricPromptSnooze';

/** Reasons that mean "try again" is worth offering, as opposed to a hardware/browser gap. */
const RETRYABLE: ReadonlySet<BiometricReason> = new Set([
	'cancelled',
	'prf-eval-failed',
	'error',
	'timeout',
	'hw-unavailable',
	'lockout',
	'busy',
	'not-ready'
]);

// Acceptance Scenario 4 (US1): offered once, right after the user is unlocked, on any
// device that supports it. Declining just dismisses it — the PIN keeps working exactly
// as before, since it's the mandatory fallback regardless (spec.md Assumptions).
export function BiometricEnrollmentPrompt({
	getPin,
	onDone
}: {
	/** Reads the PIN at the moment enrollment runs. Deliberately a getter rather than a
	 *  `pin` prop: a prop would place the raw PIN in the React element tree, where DevTools,
	 *  the profiler, and any future error reporter would capture it (Principle II). */
	getPin: () => string | null;
	onDone: () => void;
}) {
	const [dismissed, setDismissed] = useState(false);
	const [enrolling, setEnrolling] = useState(false);
	const [availability, setAvailability] = useState<BiometricAvailability | null>(null);
	const [unavailableReason, setUnavailableReason] = useState<BiometricReason | null>(null);
	// Set only after a `prf-eval-failed` result, whose credential already exists — retrying
	// through this instead of a fresh `enrollBiometricUnlock` avoids minting another one.
	const [pendingRetry, setPendingRetry] = useState<PendingBiometricEnrollment | null>(null);

	const checkAvailability = useCallback(async () => {
		setAvailability(await getBiometricAvailability());
	}, []);

	useEffect(() => {
		void checkAvailability();
	}, [checkAvailability]);

	// Hardware or a browser that can never do this: there is nothing to offer, and since nothing
	// else will clear the PIN the parent is holding for enrollment, hand it back now.
	const hopeless =
		availability !== null &&
		!availability.available &&
		(availability.provider === 'none' ||
			availability.reason === 'no-hardware' ||
			availability.reason === 'unsupported');
	useEffect(() => {
		if (hopeless && !dismissed) {
			setDismissed(true);
			onDone();
		}
	}, [hopeless, dismissed, onDone]);

	if (dismissed || availability === null) return null;

	async function handleEnable() {
		const pin = getPin();
		if (!pin) {
			// The PIN is only held for the moment between unlock and this prompt; a session
			// resumed across a reload never has one. Enrollment must be done right after a
			// manual unlock.
			setUnavailableReason('error');
			return;
		}
		setEnrolling(true);
		setUnavailableReason(null);
		try {
			const result = await enrollBiometricUnlock(pin, pendingRetry);
			if (!result.ok) {
				setUnavailableReason(result.reason);
				setPendingRetry(result.pending ?? null);
				return;
			}
			setPendingRetry(null);
			await UserProfileRepository.update(result.profilePatch);
			setDismissed(true);
			onDone();
		} finally {
			setEnrolling(false);
		}
	}

	function handleSkip() {
		// Declining is remembered, or the offer would be back after every PIN unlock.
		snoozeBiometricPrompt();
		setDismissed(true);
		onDone();
	}

	// Not offering enrollment at all (e.g. no fingerprint added on the phone yet) is different from
	// an enrollment that failed: say why, and let the user re-check after fixing it.
	const blockedReason = !availability.available ? (availability.reason ?? 'unsupported') : null;
	const shownReason = unavailableReason ?? blockedReason;

	return (
		<div className="border-b bg-muted/40 px-4 py-3">
			{shownReason ? (
				<div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
					<p>{describeBiometricReason(shownReason)}</p>
					<div className="ml-auto flex gap-2">
						{unavailableReason && RETRYABLE.has(unavailableReason) && (
							<Button size="sm" variant="outline" disabled={enrolling} onClick={handleEnable}>
								{enrolling ? 'Retrying…' : 'Retry'}
							</Button>
						)}
						{!unavailableReason && blockedReason && (
							<Button size="sm" variant="outline" onClick={() => void checkAvailability()}>
								Check again
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
