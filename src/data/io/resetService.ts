import { clearAllTables } from '../dexie/clearAllTables';
import { clearNativeBiometric, isNativeBiometricAvailable } from '../../lib/native/nativeBiometric';
import {
	TransactionCapture,
	isTransactionCaptureAvailable
} from '../../lib/native/transactionCapture';
import { clearSetupStorage } from '../../lib/safeStorage';

/**
 * Resets the entire app to first-run state by clearing all Dexie tables (spec 016, FR-013).
 * No re-seeding, no default data insertion — the caller (BackupSettingsPage) is responsible
 * for the post-clear reload, which routes to onboarding via App.tsx's existing gate.
 *
 * Also clears this device's scheduled-backup configuration and backup log — see `clearAllTables`.
 *
 * Does not require a CryptoKey — it clears tables, not decrypt/re-encrypt data.
 */
export async function resetAllData(): Promise<void> {
	await clearAllTables({ includeLocalSettings: true });
}

/**
 * Everything "Clear all data" and "Forgot PIN → erase" promise: the database, the fingerprint
 * secret and the queue of captured messages that live outside it, and the per-device flags kept
 * in localStorage (the seen-tour flag among them, so a reset really does behave like first run).
 * The caller reloads afterwards.
 */
export async function resetEverything(): Promise<void> {
	await resetAllData();
	// The fingerprint secret lives outside the database, so wiping the data would otherwise
	// leave it behind for the next profile to trip over.
	if (isNativeBiometricAvailable()) await clearNativeBiometric().catch(() => {});
	// Likewise messages already captured and queued natively: they would otherwise flow into
	// the next profile's ledger.
	if (isTransactionCaptureAvailable()) await TransactionCapture.clear().catch(() => {});
	clearSetupStorage();
}
