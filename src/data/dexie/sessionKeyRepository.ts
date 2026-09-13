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

	/**
	 * Returns the persisted key and its original auto-lock deadline if present and not yet
	 * expired; clears and returns null otherwise. Callers MUST schedule the next auto-lock off
	 * `expiresAt` (the remaining time), not a fresh full-length timeout — the deadline was set
	 * by the activity that preceded this reload, not by the reload itself.
	 */
	async restore(): Promise<{ key: CryptoKey; expiresAt: number } | null> {
		const row = await db.sessionKeys.get(SESSION_ID);
		if (!row) return null;
		if (row.expiresAt <= Date.now()) {
			await db.sessionKeys.delete(SESSION_ID);
			return null;
		}
		return { key: row.key, expiresAt: row.expiresAt };
	},

	async clear(): Promise<void> {
		await db.sessionKeys.delete(SESSION_ID);
	}
};
