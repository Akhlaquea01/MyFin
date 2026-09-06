import { db, type DebtPlannerPreferenceRow } from './db';
import { putEncrypted, getDecrypted } from './encryptedTable';
import type { DebtPlannerPreference } from '../../domain/entities';

const PREFERENCE_ID = 'local-user' as const;

const DEFAULT_PREFERENCE: Omit<DebtPlannerPreference, 'createdAt' | 'updatedAt'> = {
	id: PREFERENCE_ID,
	strategy: 'avalanche',
	extraMonthlyPayment: 0
};

export const DebtPlannerPreferenceRepository = {
	/**
	 * Returns the singleton preference, or an in-memory default when none has been saved
	 * yet — this does NOT write the default to storage; only `save` persists a value.
	 */
	async get(key: CryptoKey): Promise<DebtPlannerPreference> {
		const existing = await getDecrypted<DebtPlannerPreferenceRow, DebtPlannerPreference>(
			db.debtPlannerPreferences,
			key,
			PREFERENCE_ID
		);
		if (existing) return existing;
		const now = Date.now();
		return { ...DEFAULT_PREFERENCE, createdAt: now, updatedAt: now };
	},

	async save(
		key: CryptoKey,
		pref: Pick<DebtPlannerPreference, 'strategy' | 'extraMonthlyPayment'>
	): Promise<DebtPlannerPreference> {
		const existing = await getDecrypted<DebtPlannerPreferenceRow, DebtPlannerPreference>(
			db.debtPlannerPreferences,
			key,
			PREFERENCE_ID
		);
		const now = Date.now();
		const updated: DebtPlannerPreference = {
			id: PREFERENCE_ID,
			strategy: pref.strategy,
			extraMonthlyPayment: pref.extraMonthlyPayment,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now
		};
		await putEncrypted(db.debtPlannerPreferences, key, updated, {});
		return updated;
	}
};
