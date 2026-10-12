import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import {
	BACKGROUND_LOCK_GRACE_MS,
	SessionProvider,
	useSession
} from '../../src/context/SessionContext';
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
 * "Lock when I leave the app": with it on, a return to the foreground after more than the grace
 * period locks regardless of the inactivity timeout; a quick trip out (a permission prompt, a file
 * picker) does not. With it off, only the normal timeout applies.
 */
describe('handleAppActiveChange', () => {
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

	async function leaveAndReturn(awayMs: number): Promise<boolean> {
		let locked = false;
		await act(async () => {
			session.handleAppActiveChange(false);
		});
		vi.setSystemTime(t0 + awayMs);
		await act(async () => {
			locked = session.handleAppActiveChange(true);
		});
		return locked;
	}

	it('does not lock after a long absence when the option is off and the timeout has not passed', async () => {
		const locked = await leaveAndReturn(BACKGROUND_LOCK_GRACE_MS * 3);
		expect(locked).toBe(false);
		expect(session.isLocked).toBe(false);
	});

	it('locks after more than the grace period away when the option is on', async () => {
		await act(async () => {
			session.setLockOnBackground(true);
		});
		const locked = await leaveAndReturn(BACKGROUND_LOCK_GRACE_MS + 1_000);
		expect(locked).toBe(true);
		expect(session.isLocked).toBe(true);
	});

	it('does not lock for a quick trip out when the option is on', async () => {
		await act(async () => {
			session.setLockOnBackground(true);
		});
		const locked = await leaveAndReturn(5_000);
		expect(locked).toBe(false);
		expect(session.isLocked).toBe(false);
	});

	it('still enforces the ordinary timeout when the option is off', async () => {
		const locked = await leaveAndReturn(TIMEOUT_MS + 1_000);
		expect(locked).toBe(true);
		expect(session.isLocked).toBe(true);
	});
});
