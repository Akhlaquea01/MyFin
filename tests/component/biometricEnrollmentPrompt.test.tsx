import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../src/lib/biometric', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/lib/biometric')>()),
	getBiometricAvailability: vi.fn(),
	enrollBiometricUnlock: vi.fn()
}));

import { BiometricEnrollmentPrompt } from '../../src/components/BiometricEnrollmentPrompt';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { db } from '../../src/data/dexie/db';
import * as biometric from '../../src/lib/biometric';

describe('BiometricEnrollmentPrompt', () => {
	beforeEach(async () => {
		vi.resetAllMocks();
		await db.delete();
		await db.open();
		await UserProfileRepository.create({
			pinVerifierHash: 'h',
			pinSalt: 's',
			encryptionSalt: 'e',
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
	});

	it('hands the PIN back and shows nothing on a device that can never do biometrics', async () => {
		vi.mocked(biometric.getBiometricAvailability).mockResolvedValue({
			provider: 'native',
			available: false,
			reason: 'no-hardware'
		});
		const onDone = vi.fn();
		const { container } = render(
			<BiometricEnrollmentPrompt getPin={() => '482915'} onDone={onDone} />
		);

		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
		expect(container).toBeEmptyDOMElement();
	});

	it('says what to fix when no fingerprint is set up on the phone', async () => {
		vi.mocked(biometric.getBiometricAvailability).mockResolvedValue({
			provider: 'native',
			available: false,
			reason: 'none-enrolled'
		});
		render(<BiometricEnrollmentPrompt getPin={() => '482915'} onDone={() => {}} />);

		expect(await screen.findByText(/No fingerprint is set up on this phone/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Enable' })).toBeNull();
	});

	it('enrolls, saves the profile patch, and finishes', async () => {
		vi.mocked(biometric.getBiometricAvailability).mockResolvedValue({
			provider: 'native',
			available: true
		});
		vi.mocked(biometric.enrollBiometricUnlock).mockResolvedValue({
			ok: true,
			profilePatch: {
				biometricEnabled: true,
				nativeBiometric: { wrappedPin: { iv: 'a', ciphertext: 'b' }, enrolledAt: 1 }
			}
		});
		const onDone = vi.fn();
		render(<BiometricEnrollmentPrompt getPin={() => '482915'} onDone={onDone} />);

		await userEvent.click(await screen.findByRole('button', { name: 'Enable' }));

		await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
		const saved = await UserProfileRepository.get();
		expect(saved?.biometricEnabled).toBe(true);
		expect(saved?.nativeBiometric?.wrappedPin).toEqual({ iv: 'a', ciphertext: 'b' });
	});

	it('shows the specific reason when enrolling fails and offers a retry for a cancel', async () => {
		vi.mocked(biometric.getBiometricAvailability).mockResolvedValue({
			provider: 'native',
			available: true
		});
		vi.mocked(biometric.enrollBiometricUnlock).mockResolvedValue({
			ok: false,
			reason: 'cancelled'
		});
		render(<BiometricEnrollmentPrompt getPin={() => '482915'} onDone={() => {}} />);

		await userEvent.click(await screen.findByRole('button', { name: 'Enable' }));

		expect(await screen.findByText('Fingerprint check was cancelled.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
		expect((await UserProfileRepository.get())?.biometricEnabled).toBe(false);
	});
});
