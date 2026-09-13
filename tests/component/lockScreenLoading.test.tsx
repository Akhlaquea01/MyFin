import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LockScreen } from '../../src/components/LockScreen';
import { SessionProvider } from '../../src/context/SessionContext';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { db } from '../../src/data/dexie/db';

/**
 * Regression: the initial `UserProfileRepository.get()` fetch had no loading state and no
 * `.catch()`. While `profile` was still `null`, the PIN field and Unlock button were already
 * enabled (since the lockout gate defaults to "allowed"), so a user could try to submit before
 * the fetch resolved and `handleSubmit`'s `if (!profile) return` would silently no-op — no
 * spinner, no error, nothing to explain why nothing happened. A rejected fetch left the screen
 * in that same silent, permanently-unusable state.
 */
describe('LockScreen initial profile load', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function renderLockScreen() {
		render(<LockScreen onunlock={() => {}} />, {
			wrapper: ({ children }) => <SessionProvider>{children}</SessionProvider>
		});
	}

	it('disables the form and shows a loading state before the profile fetch resolves', async () => {
		let resolveFetch: (v: undefined) => void = () => {};
		vi.spyOn(UserProfileRepository, 'get').mockReturnValue(
			new Promise((resolve) => {
				resolveFetch = resolve;
			})
		);

		renderLockScreen();

		const button = screen.getByRole('button', { name: /loading/i });
		expect(button).toBeDisabled();
		expect(screen.getByLabelText('PIN')).toBeDisabled();

		resolveFetch(undefined);
		await waitFor(() => expect(screen.getByRole('button', { name: 'Unlock' })).toBeInTheDocument());
	});

	it('shows a retryable error instead of silently failing when the fetch rejects', async () => {
		await db.delete();
		await db.open();
		vi.spyOn(UserProfileRepository, 'get').mockRejectedValueOnce(new Error('IDB blocked'));

		renderLockScreen();

		await waitFor(() => expect(screen.getByText(/could not load your profile/i)).toBeInTheDocument());
		const retryButton = screen.getByRole('button', { name: 'Retry' });
		expect(retryButton).toBeInTheDocument();
		expect(screen.getByLabelText('PIN')).toBeDisabled();

		// A real (unmocked) retry succeeds once the transient failure is over.
		await userEvent.click(retryButton);
		await waitFor(() => expect(screen.getByRole('button', { name: 'Unlock' })).toBeInTheDocument());
		expect(screen.queryByText(/could not load your profile/i)).not.toBeInTheDocument();
	});
});
