import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ resetEverything: vi.fn() }));
vi.mock('../../src/data/io/resetService', () => ({
	resetEverything: () => mocks.resetEverything()
}));

import { LockScreen } from '../../src/components/LockScreen';
import { SessionProvider } from '../../src/context/SessionContext';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { db } from '../../src/data/dexie/db';
import { hashPin, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

/**
 * The lock screen used to be a dead end for someone who forgot their PIN: no recovery, no reset,
 * and nothing saying so. "Forgot your PIN?" is the way out — an explicit, typed-confirmation erase.
 */
describe('LockScreen — Forgot your PIN?', () => {
	// Deriving the PIN verifier is real PBKDF2; with the rest of the suite running beside it the
	// default 5 s is not always enough.
	vi.setConfig({ testTimeout: 30_000 });

	beforeEach(async () => {
		vi.clearAllMocks();
		mocks.resetEverything.mockResolvedValue(undefined);
		await db.delete();
		await db.open();
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin('482915', pinSalt),
			pinSalt,
			encryptionSalt: randomSaltBase64(),
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
	});

	function renderLockScreen() {
		render(<LockScreen onunlock={() => {}} />, {
			wrapper: ({ children }) => <SessionProvider>{children}</SessionProvider>
		});
	}

	it('explains that the PIN cannot be recovered and keeps erasing disabled until it is typed out', async () => {
		const user = userEvent.setup();
		renderLockScreen();

		await user.click(
			await screen.findByRole('button', { name: 'Forgot your PIN?' }, { timeout: 8000 })
		);

		const dialog = await screen.findByRole('dialog', {}, { timeout: 8000 });
		expect(dialog).toHaveTextContent(/cannot recover it or reset it/i);
		const erase = screen.getByRole('button', { name: 'Erase and start over' });
		expect(erase).toBeDisabled();

		await user.type(screen.getByLabelText(/Type DELETE EVERYTHING/), 'delete everything');
		expect(erase).toBeDisabled();
		expect(mocks.resetEverything).not.toHaveBeenCalled();
	});

	it('erases everything once the exact phrase is typed', async () => {
		const reload = vi.fn();
		vi.stubGlobal('location', { ...window.location, reload });
		const user = userEvent.setup();
		renderLockScreen();

		await user.click(
			await screen.findByRole('button', { name: 'Forgot your PIN?' }, { timeout: 8000 })
		);
		await user.type(
			await screen.findByLabelText(/Type DELETE EVERYTHING/, {}, { timeout: 8000 }),
			'DELETE EVERYTHING'
		);
		await user.click(screen.getByRole('button', { name: 'Erase and start over' }));

		await waitFor(() => expect(mocks.resetEverything).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(reload).toHaveBeenCalled());
		vi.unstubAllGlobals();
	});

	it('Cancel closes the dialog without erasing anything', async () => {
		const user = userEvent.setup();
		renderLockScreen();

		await user.click(
			await screen.findByRole('button', { name: 'Forgot your PIN?' }, { timeout: 8000 })
		);
		await user.click(await screen.findByRole('button', { name: 'Cancel' }, { timeout: 8000 }));

		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		expect(mocks.resetEverything).not.toHaveBeenCalled();
	});
});
