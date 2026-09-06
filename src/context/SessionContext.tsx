import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_AUTO_LOCK_TIMEOUT_MS } from '../domain/entities';

interface SessionContextValue {
	isOnboarded: boolean;
	isLocked: boolean;
	setOnboarded: (onboarded: boolean) => void;
	unlock: (key: CryptoKey, timeoutMs: number) => void;
	lock: () => void;
	recordActivity: () => void;
	getEncryptionKey: () => CryptoKey;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
	const [isOnboarded, setIsOnboarded] = useState(false);
	const [isLocked, setIsLocked] = useState(true);

	// The derived encryption key lives only in a ref, never in reactive state — it must
	// never be persisted or exposed to anything that could log/serialize state
	// (Constitution Principle II).
	const encryptionKeyRef = useRef<CryptoKey | null>(null);
	const autoLockTimeoutMsRef = useRef(DEFAULT_AUTO_LOCK_TIMEOUT_MS);
	const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const lock = useCallback(() => {
		encryptionKeyRef.current = null;
		if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
		setIsLocked(true);
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
		},
		[scheduleAutoLock]
	);

	const recordActivity = useCallback(() => {
		if (!isLocked) scheduleAutoLock();
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
