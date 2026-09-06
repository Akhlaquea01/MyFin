import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { UserProfileRepository } from '../data/dexie/userProfileRepository';
import { hashPin, deriveEncryptionKey, randomSaltBase64 } from '../data/crypto/cryptoService';
import { requestPersistentStorage } from '../data/storage/persistence';
import { useSession } from '../context/SessionContext';
import { DEFAULT_AUTO_LOCK_TIMEOUT_MS } from '../domain/entities';

const PIN_PATTERN = /^\d{4,10}$/;

// User Story 1 (P1): first-run PIN setup. Creates the UserProfile (FR-001, FR-004),
// requests durable storage (FR-044), and derives the in-memory encryption key so the
// rest of the app can start immediately (Constitution Principle II: key never persisted).
export function OnboardingScreen({ onunlock }: { onunlock: (pin: string) => void }) {
	const session = useSession();
	const [pin, setPin] = useState('');
	const [confirmPin, setConfirmPin] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	async function handleSubmit(event: FormEvent) {
		event.preventDefault();
		setError(null);

		if (!PIN_PATTERN.test(pin)) {
			setError('PIN must be 4-10 digits.');
			return;
		}
		if (pin !== confirmPin) {
			setError('PINs do not match.');
			return;
		}

		setSubmitting(true);
		try {
			const pinSalt = randomSaltBase64();
			const encryptionSalt = randomSaltBase64();
			const pinVerifierHash = await hashPin(pin, pinSalt);
			const storagePersisted = await requestPersistentStorage();

			await UserProfileRepository.create({
				pinVerifierHash,
				pinSalt,
				encryptionSalt,
				biometricEnabled: false,
				autoLockTimeoutMs: DEFAULT_AUTO_LOCK_TIMEOUT_MS,
				storagePersisted
			});

			const key = await deriveEncryptionKey(pin, encryptionSalt);
			session.unlock(key, DEFAULT_AUTO_LOCK_TIMEOUT_MS);
			onunlock(pin);
		} catch {
			setError('Could not set up your PIN. Please try again.');
		} finally {
			setSubmitting(false);
			setPin('');
			setConfirmPin('');
		}
	}

	return (
		<div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6">
			<Card className="w-full max-w-sm">
				<CardHeader className="items-center text-center">
					<div className="mb-2 flex size-12 items-center justify-center rounded-full bg-primary/10">
						<ShieldCheck className="size-6 text-primary" />
					</div>
					<CardTitle className="text-xl" role="heading" aria-level={1}>
						Welcome
					</CardTitle>
					<CardDescription>
						Set a PIN to protect your financial data. There is no way to recover it if you forget it
						— write it down somewhere safe.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="create-pin">Create PIN</Label>
							<Input
								id="create-pin"
								type="password"
								inputMode="numeric"
								autoComplete="new-password"
								className="text-center tracking-widest"
								value={pin}
								onChange={(e) => setPin(e.target.value)}
								disabled={submitting}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="confirm-pin">Confirm PIN</Label>
							<Input
								id="confirm-pin"
								type="password"
								inputMode="numeric"
								autoComplete="new-password"
								className="text-center tracking-widest"
								value={confirmPin}
								onChange={(e) => setConfirmPin(e.target.value)}
								disabled={submitting}
							/>
						</div>
						{error && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
						<Button type="submit" disabled={submitting} className="w-full">
							{submitting ? 'Setting up…' : 'Set PIN'}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
