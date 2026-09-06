import { db, type NotificationPreferenceRow } from './db';
import { putEncrypted, getDecrypted } from './encryptedTable';
import type { NotificationPreference, NotifiedItem } from '../../domain/entities';

const PREFERENCE_ID = 'local-user' as const;

const DEFAULT_PREFERENCE: Omit<NotificationPreference, 'createdAt' | 'updatedAt'> = {
	id: PREFERENCE_ID,
	enabled: true,
	reminderLeadDays: 1,
	budgetThresholdPercent: 80,
	permissionPromptDismissed: false
};

export const NotificationPreferenceRepository = {
	/**
	 * Returns the singleton preference, or an in-memory default when none has been saved
	 * yet — this does NOT write the default to storage; only `save` persists a value.
	 */
	async get(key: CryptoKey): Promise<NotificationPreference> {
		const existing = await getDecrypted<NotificationPreferenceRow, NotificationPreference>(
			db.notificationPreferences,
			key,
			PREFERENCE_ID
		);
		if (existing) return existing;
		const now = Date.now();
		return { ...DEFAULT_PREFERENCE, createdAt: now, updatedAt: now };
	},

	async save(
		key: CryptoKey,
		pref: Partial<
			Pick<
				NotificationPreference,
				'enabled' | 'reminderLeadDays' | 'budgetThresholdPercent' | 'permissionPromptDismissed'
			>
		>
	): Promise<NotificationPreference> {
		const current = await this.get(key);
		const updated: NotificationPreference = {
			...current,
			...pref,
			id: PREFERENCE_ID,
			updatedAt: Date.now()
		};
		await putEncrypted(db.notificationPreferences, key, updated, {});
		return updated;
	}
};

export const NotifiedItemRepository = {
	// `_key` is unused (an existence check needs no decryption, only the indexed column)
	// but kept for signature symmetry with the rest of this repository's methods.
	async exists(_key: CryptoKey, dedupeKey: string): Promise<boolean> {
		const row = await db.notifiedItems.where('key').equals(dedupeKey).first();
		return row !== undefined;
	},

	async create(key: CryptoKey, input: { key: string }): Promise<NotifiedItem> {
		const now = Date.now();
		const item: NotifiedItem = {
			id: crypto.randomUUID(),
			key: input.key,
			createdAt: now,
			updatedAt: now
		};
		await putEncrypted(db.notifiedItems, key, item, { key: item.key });
		return item;
	}
};
