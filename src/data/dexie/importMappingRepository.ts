import { db, type ImportMappingRow } from './db';
import { putEncrypted, decryptRows } from './encryptedTable';
import type { ImportMappingPreset } from '../../domain/entities';
import type { ImportMappingPresetInput } from '../../domain/io/importMappingPresets';

export const ImportMappingRepository = {
	/** All remembered layouts — one per bank format, so a handful of rows at most. */
	async list(key: CryptoKey): Promise<ImportMappingPreset[]> {
		return decryptRows<ImportMappingRow, ImportMappingPreset>(
			key,
			await db.importMappings.toArray()
		);
	},

	async findBySignature(key: CryptoKey, signature: string): Promise<ImportMappingPreset | null> {
		return (await this.list(key)).find((preset) => preset.signature === signature) ?? null;
	},

	/** Remembers `input`, replacing what was remembered for the same file layout. */
	async save(key: CryptoKey, input: ImportMappingPresetInput): Promise<ImportMappingPreset> {
		const existing = await this.findBySignature(key, input.signature);
		const now = Date.now();
		const preset: ImportMappingPreset = {
			...input,
			id: existing?.id ?? crypto.randomUUID(),
			createdAt: existing?.createdAt ?? now,
			updatedAt: now
		};
		await putEncrypted(db.importMappings, key, preset, {});
		return preset;
	},

	async delete(id: string): Promise<void> {
		await db.importMappings.delete(id);
	}
};
