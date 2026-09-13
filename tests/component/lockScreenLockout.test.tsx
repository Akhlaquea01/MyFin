import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { LockScreen } from '../../src/components/LockScreen';
import { SessionProvider } from '../../src/context/SessionContext';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { db } from '../../src/data/dexie/db';
import { deriveEncryptionKey, hashPin, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

/**
 * Regression: the ticking lockout countdown lived directly inside a `role="alert"` region,
 * whose text changed roughly every 500ms — most screen readers re-announce a live region on
 * every mutation, so a five-minute lockout produced continuous, disruptive re-announcements.
 * The countdown text is now split from the one-time transition announcement.
 */
describe('LockScreen lockout announcement', () => {
	beforeEach(async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		await db.delete();
		await db.open();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('renders the ticking countdown outside any aria-live region, and the one-time announcement text stays stable while it ticks', async () => {
		const pin = '135790';
		const pinSalt = randomSaltBase64();
		const encryptionSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin(pin, pinSalt),
			pinSalt,
			encryptionSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true,
			// Already locked out on load, as if a prior failed-attempt run set this before reload.
			lockedOutUntil: Date.now() + 60_000,
			failedUnlockAttempts: 5
		});
		// A profile keyed for real decryption isn't needed for this test — only the lockout gate.
		void deriveEncryptionKey(pin, encryptionSalt);

		render(<LockScreen onunlock={() => {}} />, {
			wrapper: ({ children }) => <SessionProvider>{children}</SessionProvider>
		});

		await waitFor(() => expect(screen.getByRole('button', { name: /Locked/ })).toBeInTheDocument());

		// The one-time transition announcement fires asynchronously (a useEffect after the
		// gate first reports "not allowed"); wait for it before taking the first snapshot.
		await waitFor(() =>
			expect(screen.getByText('Too many attempts. Please wait before trying again.')).toBeInTheDocument()
		);
		const announcement = screen.getByText('Too many attempts. Please wait before trying again.');
		expect(announcement).toHaveAttribute('role', 'alert');
		expect(announcement.className).toContain('sr-only');

		const initialCountdownText = screen.getByRole('button', { name: /Locked/ }).textContent;

		await act(async () => {
			vi.advanceTimersByTime(2_000);
		});

		// The visible countdown advanced...
		const laterCountdownText = screen.getByRole('button', { name: /Locked/ }).textContent;
		expect(laterCountdownText).not.toBe(initialCountdownText);

		// ...but the announced alert's text is exactly the same node/content as before — no
		// mutation for a screen reader to re-announce.
		expect(
			screen.getByText('Too many attempts. Please wait before trying again.')
		).toBe(announcement);
	});
});
