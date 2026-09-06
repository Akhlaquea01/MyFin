import { db } from './db';

const SESSION_ID = 'local-session' as const;

/**
 * Persists the in-memory encryption key across a page reload (spec 009). The key itself is
 * never extractable — see the SessionKeyRow doc comment in db.ts — so this only ever hands
 * back a usable CryptoKey handle, never raw bytes. `expiresAt` is checked on every restore so
 * a reload past the caller's own auto-lock deadline still requires PIN/biometric re-entry.
 */
export const SessionKeyRepository = {
	async save(key: CryptoKey, expiresAt: number): Promise<void> {
		await db.sessionKeys.put({ id: SESSION_ID, key, expiresAt });
	},

	/** Returns the persisted key if present and not yet expired; clears and returns null otherwise. */
	async restore(): Promise<CryptoKey | null> {
		const row = await db.sessionKeys.get(SESSION_ID);
		if (!row) return null;
		if (row.expiresAt <= Date.now()) {
			await db.sessionKeys.delete(SESSION_ID);
			return null;
		}
		return row.key;
	},

	async clear(): Promise<void> {
		await db.sessionKeys.delete(SESSION_ID);
	}
};
