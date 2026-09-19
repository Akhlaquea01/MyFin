import { db } from './db';
import type { AutoBackupSettings } from '../../domain/entities';

const SETTINGS_ID = 'local-user' as const;

const DEFAULTS: AutoBackupSettings = {
	id: SETTINGS_ID,
	enabled: false,
	intervalDays: 7
};

/** Unencrypted, same category as `sessionKeys`/`userProfile` — see AutoBackupSettings' own
 *  doc comment in entities.ts for why. */
export const AutoBackupSettingsRepository = {
	async get(): Promise<AutoBackupSettings> {
		return (await db.autoBackupSettings.get(SETTINGS_ID)) ?? DEFAULTS;
	},

	async update(changes: Partial<Omit<AutoBackupSettings, 'id'>>): Promise<AutoBackupSettings> {
		const existing = await this.get();
		const updated: AutoBackupSettings = { ...existing, ...changes, id: SETTINGS_ID };
		await db.autoBackupSettings.put(updated);
		return updated;
	}
};
