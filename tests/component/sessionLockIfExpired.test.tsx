import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { SessionProvider, useSession } from '../../src/context/SessionContext';
import { db } from '../../src/data/dexie/db';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

const TIMEOUT_MS = 5 * 60 * 1000;

type Session = ReturnType<typeof useSession>;

function Harness({ onSession }: { onSession: (s: Session) => void }) {
	const session = useSession();
	onSession(session);
	return <div data-testid="state">{session.isLocked ? 'locked' : 'unlocked'}</div>;
}

/**
 * While the Android app is in the background the WebView's timers are throttled or frozen, so the
 * inactivity timer can miss its deadline. `lockIfExpired` is how the app enforces the timeout when
 * it comes back, and these tests move the clock WITHOUT firing any timers to reproduce that.
 */
describe('lockIfExpired', () => {
	let key: CryptoKey;
	let session: Session;
	const t0 = new Date('2026-10-11T10:00:00Z').getTime();

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('482915', randomSaltBase64());
		vi.useFakeTimers({ toFake: ['Date'], now: t0 });
		render(<Harness onSession={(s) => (session = s)} />, {
			wrapper: ({ children }) => <SessionProvider>{children}</SessionProvider>
		});
		await act(async () => {
			session.unlock(key, TIMEOUT_MS);
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('does nothing inside the window', async () => {
		vi.setSystemTime(t0 + TIMEOUT_MS - 1_000);
		let locked = true;
		await act(async () => {
			locked = session.lockIfExpired();
		});
		expect(locked).toBe(false);
		expect(session.isLocked).toBe(false);
	});

	it('locks once the deadline has passed even though no timer fired', async () => {
		vi.setSystemTime(t0 + TIMEOUT_MS + 1_000);
		let locked = false;
		await act(async () => {
			locked = session.lockIfExpired();
		});
		expect(locked).toBe(true);
		expect(session.isLocked).toBe(true);
		expect(() => session.getEncryptionKey()).toThrow();
	});

	it('counts activity as extending the deadline', async () => {
		vi.setSystemTime(t0 + TIMEOUT_MS - 1_000);
		await act(async () => {
			session.recordActivity();
		});
		vi.setSystemTime(t0 + TIMEOUT_MS + 60_000);
		let locked = true;
		await act(async () => {
			locked = session.lockIfExpired();
		});
		expect(locked).toBe(false);
		expect(session.isLocked).toBe(false);
	});

	it('applies a new timeout straight away', async () => {
		await act(async () => {
			session.setAutoLockTimeout(60_000);
		});
		vi.setSystemTime(t0 + 61_000);
		let locked = false;
		await act(async () => {
			locked = session.lockIfExpired();
		});
		expect(locked).toBe(true);
	});

	it('is a no-op when already locked', async () => {
		await act(async () => {
			session.lock();
		});
		let locked = true;
		await act(async () => {
			locked = session.lockIfExpired();
		});
		expect(locked).toBe(false);
	});
});
