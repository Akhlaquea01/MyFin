import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

vi.mock('../../src/lib/native/platform', () => ({
	isNativeApp: vi.fn(() => true),
	isNativePluginAvailable: vi.fn(() => true)
}));
vi.mock('../../src/lib/biometric', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/lib/biometric')>()),
	isBiometricEnrolled: vi.fn(),
	unlockWithBiometric: vi.fn(),
	disableBiometric: vi.fn()
}));

import { LockScreen } from '../../src/components/LockScreen';
import { SessionProvider } from '../../src/context/SessionContext';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { db } from '../../src/data/dexie/db';
import { hashPin, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import * as biometric from '../../src/lib/biometric';

const PIN = '482915';

async function createProfile(extra: Record<string, unknown> = {}) {
	const pinSalt = randomSaltBase64();
	return UserProfileRepository.create({
		pinVerifierHash: await hashPin(PIN, pinSalt),
		pinSalt,
		encryptionSalt: randomSaltBase64(),
		biometricEnabled: true,
		autoLockTimeoutMs: 300_000,
		storagePersisted: true,
		...extra
	});
}

function renderLock(onunlock: (pin: string) => void = () => {}) {
	return render(<LockScreen onunlock={onunlock} />, {
		wrapper: ({ children }) => <SessionProvider>{children}</SessionProvider>
	});
}

describe('LockScreen fingerprint (Android app)', () => {
	beforeEach(async () => {
		vi.resetAllMocks();
		await db.delete();
		await db.open();
		vi.mocked(biometric.isBiometricEnrolled).mockResolvedValue(true);
	});

	it('opens the fingerprint prompt by itself, once, and unlocks with the recovered PIN', async () => {
		await createProfile();
		vi.mocked(biometric.unlockWithBiometric).mockResolvedValue({ ok: true, pin: PIN });
		const onunlock = vi.fn();
		renderLock(onunlock);

		await waitFor(() => expect(onunlock).toHaveBeenCalledWith(PIN), { timeout: 5000 });
		expect(biometric.unlockWithBiometric).toHaveBeenCalledTimes(1);
	});

	it('does not nag when the prompt is cancelled, and leaves the button and PIN field available', async () => {
		await createProfile();
		vi.mocked(biometric.unlockWithBiometric).mockResolvedValue({ ok: false, reason: 'cancelled' });
		renderLock();

		await waitFor(() => expect(biometric.unlockWithBiometric).toHaveBeenCalledTimes(1));
		await act(async () => {});
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByRole('button', { name: /Use biometric unlock/ })).toBeEnabled();
		expect(screen.getByLabelText('PIN')).toBeEnabled();
		expect(biometric.unlockWithBiometric).toHaveBeenCalledTimes(1);
	});

	it('explains an invalidated fingerprint, drops the enrollment, and does not count a failed PIN attempt', async () => {
		await createProfile({ failedUnlockAttempts: 2 });
		vi.mocked(biometric.unlockWithBiometric).mockResolvedValue({
			ok: false,
			reason: 'invalidated',
			clearEnrollment: true
		});
		vi.mocked(biometric.disableBiometric).mockImplementation(async () =>
			UserProfileRepository.update({ biometricEnabled: false })
		);
		renderLock();

		await waitFor(() =>
			expect(screen.getByRole('alert')).toHaveTextContent(/fingerprints on this phone changed/i)
		);
		expect(biometric.disableBiometric).toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: /Use biometric unlock/ })).toBeNull();
		expect((await UserProfileRepository.get())?.failedUnlockAttempts).toBe(2);
	});

	it('does not open the prompt while a lockout is running', async () => {
		await createProfile({ failedUnlockAttempts: 5, lockedOutUntil: Date.now() + 60_000 });
		vi.mocked(biometric.unlockWithBiometric).mockResolvedValue({ ok: true, pin: PIN });
		renderLock();

		await waitFor(() => expect(screen.getByRole('button', { name: /Locked/ })).toBeInTheDocument());
		await act(async () => {});
		expect(biometric.unlockWithBiometric).not.toHaveBeenCalled();
	});

	it('does not open the prompt when nothing is enrolled', async () => {
		await createProfile({ biometricEnabled: false });
		vi.mocked(biometric.isBiometricEnrolled).mockResolvedValue(false);
		renderLock();

		await waitFor(() => expect(screen.getByRole('button', { name: 'Unlock' })).toBeInTheDocument());
		await act(async () => {});
		expect(biometric.unlockWithBiometric).not.toHaveBeenCalled();
		expect(screen.queryByRole('button', { name: /Use biometric unlock/ })).toBeNull();
	});
});
