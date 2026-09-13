import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
	type ReactNode
} from 'react';
import { DEFAULT_AUTO_LOCK_TIMEOUT_MS } from '../domain/entities';
import { SessionKeyRepository } from '../data/dexie/sessionKeyRepository';

/** Minimum time between persisted-expiry rewrites on activity (spec 009) — activity events
 *  (click/keydown/pointerdown) can fire many times a minute; there's no benefit to an
 *  IndexedDB write on every one of them, only cost. */
const ACTIVITY_PERSIST_THROTTLE_MS = 15_000;

interface SessionContextValue {
	isOnboarded: boolean;
	isLocked: boolean;
	setOnboarded: (onboarded: boolean) => void;
	unlock: (key: CryptoKey, timeoutMs: number) => void;
	/**
	 * Attempts to silently resume a session persisted before the last reload (spec 009).
	 * Returns whether a still-valid session was found and restored. Callers should try this
	 * once at startup, before ever falling back to LockScreen.
	 */
	restoreSession: (autoLockTimeoutMs: number) => Promise<boolean>;
	lock: () => void;
	recordActivity: () => void;
	getEncryptionKey: () => CryptoKey;
}

/** Thrown by `getEncryptionKey()` when no session key is available. Named so a page-scoped
 *  error boundary (see PageErrorBoundary) can distinguish "the whole session is unusable" from
 *  an ordinary page-render bug and let this one keep propagating to the app-level ErrorBoundary,
 *  which is the only thing that can actually fix it (by returning to LockScreen). */
export class SessionLockedError extends Error {
	constructor() {
		super('App is locked: no encryption key available');
		this.name = 'SessionLockedError';
	}
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
	const [isOnboarded, setIsOnboarded] = useState(false);
	const [isLocked, setIsLocked] = useState(true);

	// The derived encryption key lives only in a ref, never in reactive state, so it can
	// never be logged/serialized as component state (Constitution Principle II). It is,
	// however, mirrored into IndexedDB as a non-extractable CryptoKey (spec 009) so a reload
	// within the auto-lock window can resume without a fresh PIN/biometric prompt — see
	// SessionKeyRepository and the SessionKeyRow doc comment in db.ts for why that still
	// holds the "raw key bytes never reachable from JS" guarantee.
	const encryptionKeyRef = useRef<CryptoKey | null>(null);
	const autoLockTimeoutMsRef = useRef(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
	const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const lastPersistedAtRef = useRef(0);
	// Mirrors `isLocked` as a ref. `recordActivity` is wired into window event listeners that
	// are registered once, on mount, and therefore capture whatever closure existed then — a
	// `useCallback` that closed over the `isLocked` *state* would be frozen at its mount-time
	// value (`true`) and silently no-op for the rest of the session, disabling auto-lock
	// reset entirely. Reading the ref keeps the check correct in a long-lived closure.
	const isLockedRef = useRef(true);

	const lock = useCallback(() => {
		encryptionKeyRef.current = null;
		if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
		isLockedRef.current = true;
		setIsLocked(true);
		// Constitution Principle II requires the persisted handle be deleted on explicit lock
		// or timeout. Nothing can be done about a failure here beyond not crashing the lock
		// itself, but the rejection must not go unhandled.
		void SessionKeyRepository.clear().catch(() => {});
	}, []);

	const scheduleAutoLock = useCallback(() => {
		if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
		inactivityTimerRef.current = setTimeout(lock, autoLockTimeoutMsRef.current);
	}, [lock]);

	const unlock = useCallback(
		(key: CryptoKey, timeoutMs: number) => {
			encryptionKeyRef.current = key;
			autoLockTimeoutMsRef.current = timeoutMs;
			isLockedRef.current = false;
			setIsOnboarded(true);
			setIsLocked(false);
			scheduleAutoLock();
			lastPersistedAtRef.current = Date.now();
			void SessionKeyRepository.save(key, Date.now() + timeoutMs).catch(() => {});
		},
		[scheduleAutoLock]
	);

	const restoreSession = useCallback(
		async (autoLockTimeoutMs: number): Promise<boolean> => {
			const restored = await SessionKeyRepository.restore();
			if (!restored) return false;
			encryptionKeyRef.current = restored.key;
			autoLockTimeoutMsRef.current = autoLockTimeoutMs;
			isLockedRef.current = false;
			setIsOnboarded(true);
			setIsLocked(false);
			lastPersistedAtRef.current = Date.now();
			// Schedule off the deadline that was already persisted, not a fresh full-length
			// window — otherwise reloading just before the real deadline grants a brand-new
			// timeout every time, letting auto-lock be postponed indefinitely.
			if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
			inactivityTimerRef.current = setTimeout(lock, Math.max(0, restored.expiresAt - Date.now()));
			return true;
		},
		[lock]
	);

	const recordActivity = useCallback(() => {
		if (isLockedRef.current) return;
		scheduleAutoLock();
		const now = Date.now();
		if (
			encryptionKeyRef.current &&
			now - lastPersistedAtRef.current > ACTIVITY_PERSIST_THROTTLE_MS
		) {
			lastPersistedAtRef.current = now;
			void SessionKeyRepository.save(
				encryptionKeyRef.current,
				now + autoLockTimeoutMsRef.current
			).catch(() => {});
		}
	}, [scheduleAutoLock]);

	const getEncryptionKey = useCallback((): CryptoKey => {
		if (!encryptionKeyRef.current) throw new SessionLockedError();
		return encryptionKeyRef.current;
	}, []);

	// A fresh object literal here would hand every consumer a new context value on each
	// render, re-rendering the whole subtree and — worse — making `session.recordActivity`
	// captured by a mount-time listener permanently stale. Memoizing keeps the identity
	// stable for as long as the values behind it are.
	const value = useMemo(
		() => ({
			isOnboarded,
			isLocked,
			setOnboarded: setIsOnboarded,
			unlock,
			restoreSession,
			lock,
			recordActivity,
			getEncryptionKey
		}),
		[isOnboarded, isLocked, unlock, restoreSession, lock, recordActivity, getEncryptionKey]
	);

	return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
	const ctx = useContext(SessionContext);
	if (!ctx) throw new Error('useSession must be used within a SessionProvider');
	return ctx;
}
