import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { SessionProvider, useSession } from '../../src/context/SessionContext';
import { db } from '../../src/data/dexie/db';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';
import { SessionKeyRepository } from '../../src/data/dexie/sessionKeyRepository';

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

/**
 * Regression: `restoreSession` (the path a page reload takes) used to call the generic
 * `scheduleAutoLock()`, which always starts a brand-new full-length timeout from "now" —
 * ignoring how much of the originally-persisted window had already elapsed. A reload moments
 * before the real deadline therefore granted a fresh full timeout every time, letting an
 * unlocked session be extended indefinitely just by reloading the tab.
 */
function RestoreHarness({ onLocked }: { onLocked?: () => void }) {
	const session = useSession();
	useEffect(() => {
		void session.restoreSession(TIMEOUT_MS);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	useEffect(() => {
		if (session.isLocked) onLocked?.();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [session.isLocked]);
	return <div data-testid="state">{session.isLocked ? 'locked' : 'unlocked'}</div>;
}

describe('restoreSession auto-lock scheduling', () => {
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

	it('locks at the originally-persisted deadline, not a fresh full timeout after restore', async () => {
		// Simulate a session that was unlocked a while ago and is now only 1s from its real
		// deadline — as if the tab is being reloaded moments before auto-lock would fire.
		await SessionKeyRepository.save(key, Date.now() + 1_000);

		render(<RestoreHarness />, {
			wrapper: ({ children }) => <SessionProvider>{children}</SessionProvider>
		});
		await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('unlocked'));

		// Advance past the real 1s deadline but nowhere near a fresh TIMEOUT_MS window. Only
		// correct if the timer was scheduled off the remaining time, not a brand-new one.
		await act(async () => {
			vi.advanceTimersByTime(1_500);
		});
		expect(screen.getByTestId('state')).toHaveTextContent('locked');
	});
});
