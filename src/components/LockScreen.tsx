import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Fingerprint, Lock } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';
import { verifyPin, deriveEncryptionKey } from '../data/crypto/cryptoService';
import { unlockPinWithBiometric, isWebAuthnSupported } from '../lib/webauthn';
import { nextLockoutMs, unlockGate, formatRemaining } from '../domain/auth/pinPolicy';
import { useSession } from '../context/SessionContext';
import type { UserProfile } from '../domain/entities';

// User Story 1 (P1): PIN unlock, with optional biometric shortcut (FR-002). A wrong PIN
// is rejected with no data revealed (Acceptance Scenario 3) — the verifier check happens
// entirely before any encryption key is derived.
export function LockScreen({ onunlock }: { onunlock: (pin: string) => void }) {
	const session = useSession();
	const [profile, setProfile] = useState<UserProfile | null>(null);
	const [pin, setPin] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [biometricAvailable, setBiometricAvailable] = useState(false);
	// True only until the initial profile fetch settles (success or failure) — distinct from
	// `profile === null`, which also describes the (should-be-unreachable) case of no profile
	// existing at all.
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(false);
	// Bumped to re-run the profile fetch from the "Retry" button after a failure.
	const [retryToken, setRetryToken] = useState(0);
	// Drives the countdown on the disabled button while a lockout is in effect.
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setLoadError(false);
		UserProfileRepository.get()
			.then((p) => {
				if (cancelled) return;
				setProfile(p ?? null);
				setBiometricAvailable(isWebAuthnSupported() && !!p?.webauthn);
			})
			.catch(() => {
				if (!cancelled) setLoadError(true);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [retryToken]);

	const lockedOutUntil = profile?.lockedOutUntil ?? null;
	const gate = unlockGate(lockedOutUntil, now);

	// Only ticks while actually locked out, so there's no idle timer in the common case.
	useEffect(() => {
		if (gate.allowed) return;
		const handle = setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(handle);
	}, [gate.allowed]);

	// Announced once per lockout transition, not once per tick: the countdown text changes
	// every 500ms, and putting that directly inside a `role="alert"` region (as the ticking
	// paragraph below used to) re-announced it to screen readers roughly once a second for up
	// to five minutes. This region's content only changes at the start/end of a lockout.
	const [lockoutAnnouncement, setLockoutAnnouncement] = useState<string | null>(null);
	const wasAllowedRef = useRef(gate.allowed);
	useEffect(() => {
		if (wasAllowedRef.current !== gate.allowed) {
			setLockoutAnnouncement(
				gate.allowed ? 'You can try again now.' : 'Too many attempts. Please wait before trying again.'
			);
			wasAllowedRef.current = gate.allowed;
		}
	}, [gate.allowed]);

	/**
	 * Records a failed attempt and, past the free allowance, sets an exponentially growing
	 * lockout deadline. Persisted via the profile so reloading doesn't reset the counter —
	 * an in-memory throttle would be trivially bypassed by refreshing the page.
	 */
	async function registerFailure(activeProfile: UserProfile): Promise<UserProfile> {
		const failedUnlockAttempts = (activeProfile.failedUnlockAttempts ?? 0) + 1;
		const lockoutMs = nextLockoutMs(failedUnlockAttempts);
		const changes = {
			failedUnlockAttempts,
			lockedOutUntil: lockoutMs > 0 ? Date.now() + lockoutMs : null
		};
		const updated = await UserProfileRepository.update(changes);
		setProfile(updated);
		setNow(Date.now());
		return updated;
	}

	async function unlockWithPin(candidatePin: string, activeProfile: UserProfile) {
		const currentGate = unlockGate(activeProfile.lockedOutUntil ?? null, Date.now());
		if (!currentGate.allowed) {
			setError(`Too many attempts. Try again in ${formatRemaining(currentGate.remainingMs)}.`);
			return;
		}

		const isCorrect = await verifyPin(
			candidatePin,
			activeProfile.pinSalt,
			activeProfile.pinVerifierHash
		);
		if (!isCorrect) {
			const updated = await registerFailure(activeProfile);
			const nextGate = unlockGate(updated.lockedOutUntil ?? null, Date.now());
			setError(
				nextGate.allowed
					? 'Incorrect PIN.'
					: `Incorrect PIN. Too many attempts — try again in ${formatRemaining(nextGate.remainingMs)}.`
			);
			return;
		}

		const cleared = await UserProfileRepository.update({
			failedUnlockAttempts: 0,
			lockedOutUntil: null
		});
		setProfile(cleared);
		const key = await deriveEncryptionKey(candidatePin, activeProfile.encryptionSalt);
		session.unlock(key, activeProfile.autoLockTimeoutMs);
		onunlock(candidatePin);
	}

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		if (!profile) return;
		setError(null);
		setSubmitting(true);
		try {
			await unlockWithPin(pin, profile);
		} catch {
			setError('Could not unlock. Please try again.');
		} finally {
			setSubmitting(false);
			setPin('');
		}
	}

	async function handleBiometric() {
		if (!profile?.webauthn) return;
		setError(null);
		setSubmitting(true);
		try {
			const recoveredPin = await unlockPinWithBiometric(profile.webauthn);
			if (!recoveredPin) {
				setError('Biometric unlock failed. Please enter your PIN.');
				return;
			}
			await unlockWithPin(recoveredPin, profile);
		} catch {
			setError('Could not unlock. Please try again.');
		} finally {
			setSubmitting(false);
		}
	}

	const lockoutNotice = gate.allowed
		? null
		: `Too many attempts. Try again in ${formatRemaining(gate.remainingMs)}.`;
	const inputsDisabled = loading || loadError || submitting || !gate.allowed;

	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
			<Card className="w-full max-w-sm">
				<CardHeader className="items-center text-center">
					<div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
						<Lock className="size-6 text-primary" />
					</div>
					<CardTitle className="text-xl" role="heading" aria-level={1}>
						Enter your PIN
					</CardTitle>
				</CardHeader>
				<CardContent>
					<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="unlock-pin">PIN</Label>
							<Input
								id="unlock-pin"
								type="password"
								inputMode="numeric"
								autoComplete="current-password"
								className="text-center tracking-widest"
								value={pin}
								onChange={(e) => setPin(e.target.value)}
								disabled={inputsDisabled}
								autoFocus
							/>
						</div>
						{loadError && (
							<p role="alert" className="text-sm text-destructive">
								Could not load your profile. Check your connection and try again.
							</p>
						)}
						{!loadError && error && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
						{!loadError && !error && lockoutNotice && (
							<>
								{/* Announced once at the start of a lockout; its text is stable while
								    ticking, so it is never re-announced mid-countdown. */}
								<p role="alert" className="sr-only">
									{lockoutAnnouncement}
								</p>
								{/* Visible, ticking countdown for sighted users — not a live region. */}
								<p className="text-sm text-destructive">{lockoutNotice}</p>
							</>
						)}
						{loadError ? (
							<Button
								type="button"
								className="w-full"
								onClick={() => setRetryToken((t) => t + 1)}
							>
								Retry
							</Button>
						) : (
							<Button type="submit" disabled={inputsDisabled || !pin} className="w-full">
								{loading
									? 'Loading…'
									: gate.allowed
										? 'Unlock'
										: `Locked (${formatRemaining(gate.remainingMs)})`}
							</Button>
						)}
					</form>
					{biometricAvailable && (
						<Button
							type="button"
							variant="outline"
							className="mt-3 w-full"
							disabled={inputsDisabled}
							onClick={handleBiometric}
						>
							<Fingerprint /> Use biometric unlock
						</Button>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
