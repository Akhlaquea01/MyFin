import { useEffect, useState, type FormEvent } from 'react';
import { Fingerprint, Lock } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';
import { verifyPin, deriveEncryptionKey } from '../data/crypto/cryptoService';
import { unlockPinWithBiometric, isWebAuthnSupported } from '../lib/webauthn';
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

	useEffect(() => {
		void UserProfileRepository.get().then((p) => {
			setProfile(p ?? null);
			setBiometricAvailable(isWebAuthnSupported() && !!p?.webauthn);
		});
	}, []);

	async function unlockWithPin(candidatePin: string, activeProfile: UserProfile) {
		const isCorrect = await verifyPin(
			candidatePin,
			activeProfile.pinSalt,
			activeProfile.pinVerifierHash
		);
		if (!isCorrect) {
			setError('Incorrect PIN.');
			return;
		}
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
		} finally {
			setSubmitting(false);
		}
	}

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
								disabled={submitting}
								autoFocus
							/>
						</div>
						{error && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
						<Button type="submit" disabled={submitting || !pin} className="w-full">
							Unlock
						</Button>
					</form>
					{biometricAvailable && (
						<Button
							type="button"
							variant="outline"
							className="mt-3 w-full"
							disabled={submitting}
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
