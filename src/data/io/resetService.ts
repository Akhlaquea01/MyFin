import { clearAllTables } from '../dexie/clearAllTables';

/**
 * Resets the entire app to first-run state by clearing all Dexie tables (spec 016, FR-013).
 * No re-seeding, no default data insertion — the caller (BackupSettingsPage) is responsible
 * for the post-clear reload, which routes to onboarding via App.tsx's existing gate.
 *
 * Does not require a CryptoKey — it clears tables, not decrypt/re-encrypt data.
 */
export async function resetAllData(): Promise<void> {
	await clearAllTables();
}
