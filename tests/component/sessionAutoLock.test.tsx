import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useEffect } from 'react';
import { SessionProvider, useSession } from '../../src/context/SessionContext';
import { db } from '../../src/data/dexie/db';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * A minimal stand-in for `App.tsx`'s Gate, reproducing the one structural detail that caused
 * the bug: the activity listeners are registered in an effect that runs on mount, so whatever
 * `recordActivity` closure exists at that moment is the one every future event calls.
 */
function ActivityHarness({ onReady }: { onReady: (unlock: (k: CryptoKey) => void) => void }) {
	const session = useSession();
	const { recordActivity, unlock } = session;

	// Registered once, on mount, and deliberately never re-registered — this is the shape that
	// exposed the bug. `recordActivity` must therefore stay correct inside a closure captured
	// while the session was still locked, which is what reading the lock flag from a ref buys.
	// (App.tsx also lists the dependency now, but the guarantee should not rest on that alone.)
	useEffect(() => {
		const onActivity = recordActivity;
		window.addEventListener('click', onActivity);
		return () => window.removeEventListener('click', onActivity);
	}, []);

	useEffect(() => {
		onReady((key: CryptoKey) => unlock(key, TIMEOUT_MS));
	}, [onReady, unlock]);

	return <div data-testid="state">{session.isLocked ? 'locked' : 'unlocked'}</div>;
}

describe('auto-lock activity tracking', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('482915', randomSaltBase64());
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function mountUnlocked() {
		let doUnlock: ((k: CryptoKey) => void) | null = null;
		render(<ActivityHarness onReady={(fn) => (doUnlock = fn)} />, {
			wrapper: ({ children }) => <SessionProvider>{children}</SessionProvider>
		});
		await act(async () => {
			doUnlock!(key);
		});
		expect(screen.getByTestId('state')).toHaveTextContent('unlocked');
	}

	/**
	 * Regression for the stale closure that disabled FR-003 entirely.
	 *
	 * `recordActivity` used to be memoized on `[isLocked, ...]`. The mount-time listener
	 * captured the variant created while `isLocked` was still its initial `true`, so every
	 * click for the rest of the session hit `if (isLocked) return` and the inactivity timer
	 * was never rescheduled — the app locked exactly `autoLockTimeoutMs` after unlock no
	 * matter how actively it was being used, destroying any half-filled form with it.
	 */
	it('resets the inactivity timer on user activity', async () => {
		await mountUnlocked();

		// Most of the way to the deadline, then a click — which must push it back.
		await act(async () => {
			vi.advanceTimersByTime(TIMEOUT_MS - 1_000);
		});
		expect(screen.getByTestId('state')).toHaveTextContent('unlocked');

		await act(async () => {
			window.dispatchEvent(new MouseEvent('click'));
		});

		// Past the *original* deadline. Still unlocked only if the click was registered.
		await act(async () => {
			vi.advanceTimersByTime(2_000);
		});
		expect(screen.getByTestId('state')).toHaveTextContent('unlocked');
	});

	it('still locks after a genuinely idle timeout', async () => {
		await mountUnlocked();
		await act(async () => {
			vi.advanceTimersByTime(TIMEOUT_MS + 1_000);
		});
		expect(screen.getByTestId('state')).toHaveTextContent('locked');
	});

	it('stays locked when activity arrives after the lock', async () => {
		await mountUnlocked();
		await act(async () => {
			vi.advanceTimersByTime(TIMEOUT_MS + 1_000);
		});
		expect(screen.getByTestId('state')).toHaveTextContent('locked');

		// A click on the lock screen must not silently revive the session.
		await act(async () => {
			window.dispatchEvent(new MouseEvent('click'));
			vi.advanceTimersByTime(1_000);
		});
		expect(screen.getByTestId('state')).toHaveTextContent('locked');
	});

	it('clears the persisted session handle on lock', async () => {
		await mountUnlocked();
		expect(await db.sessionKeys.get('local-session')).toBeDefined();

		await act(async () => {
			vi.advanceTimersByTime(TIMEOUT_MS + 1_000);
		});
		await act(async () => {
			await Promise.resolve();
		});
		expect(await db.sessionKeys.get('local-session')).toBeUndefined();
	});
});
