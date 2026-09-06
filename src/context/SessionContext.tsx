import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
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

	const lock = useCallback(() => {
		encryptionKeyRef.current = null;
		if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
		setIsLocked(true);
		void SessionKeyRepository.clear();
	}, []);

	const scheduleAutoLock = useCallback(() => {
		if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
		inactivityTimerRef.current = setTimeout(lock, autoLockTimeoutMsRef.current);
	}, [lock]);

	const unlock = useCallback(
		(key: CryptoKey, timeoutMs: number) => {
			encryptionKeyRef.current = key;
			autoLockTimeoutMsRef.current = timeoutMs;
			setIsOnboarded(true);
			setIsLocked(false);
			scheduleAutoLock();
			lastPersistedAtRef.current = Date.now();
			void SessionKeyRepository.save(key, Date.now() + timeoutMs);
		},
		[scheduleAutoLock]
	);

	const restoreSession = useCallback(
		async (autoLockTimeoutMs: number): Promise<boolean> => {
			const restored = await SessionKeyRepository.restore();
			if (!restored) return false;
			encryptionKeyRef.current = restored;
			autoLockTimeoutMsRef.current = autoLockTimeoutMs;
			setIsOnboarded(true);
			setIsLocked(false);
			lastPersistedAtRef.current = Date.now();
			scheduleAutoLock();
			return true;
		},
		[scheduleAutoLock]
	);

	const recordActivity = useCallback(() => {
		if (isLocked) return;
		scheduleAutoLock();
		const now = Date.now();
		if (encryptionKeyRef.current && now - lastPersistedAtRef.current > ACTIVITY_PERSIST_THROTTLE_MS) {
			lastPersistedAtRef.current = now;
			void SessionKeyRepository.save(encryptionKeyRef.current, now + autoLockTimeoutMsRef.current);
		}
	}, [isLocked, scheduleAutoLock]);

	const getEncryptionKey = useCallback((): CryptoKey => {
		if (!encryptionKeyRef.current) throw new Error('App is locked: no encryption key available');
		return encryptionKeyRef.current;
	}, []);

	return (
		<SessionContext.Provider
			value={{
				isOnboarded,
				isLocked,
				setOnboarded: setIsOnboarded,
				unlock,
				restoreSession,
				lock,
				recordActivity,
				getEncryptionKey
			}}
		>
			{children}
		</SessionContext.Provider>
	);
}

export function useSession(): SessionContextValue {
	const ctx = useContext(SessionContext);
	if (!ctx) throw new Error('useSession must be used within a SessionProvider');
	return ctx;
}
