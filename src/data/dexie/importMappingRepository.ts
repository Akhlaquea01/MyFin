import { db } from './db';
import { putEncrypted } from './encryptedTable';
import { decrypt } from '../crypto/cryptoService';
import type { ImportMappingPreset } from '../../domain/entities';
import type { ImportMappingPresetInput } from '../../domain/io/importMappingPresets';

export const ImportMappingRepository = {
	/**
	 * All remembered layouts — one per bank format, so a handful of rows at most. A row the key
	 * cannot open (left from before a PIN change or restore) is dropped rather than failing the
	 * whole list, which would stop the importer remembering anything ever again.
	 */
	async list(key: CryptoKey): Promise<ImportMappingPreset[]> {
		const rows = await db.importMappings.toArray();
		const settled = await Promise.allSettled(
			rows.map((row) => decrypt<ImportMappingPreset>(key, row.encryptedData))
		);
		const stale = rows.filter((_, index) => settled[index].status === 'rejected');
		if (stale.length > 0) {
			await db.importMappings.bulkDelete(stale.map((row) => row.id)).catch(() => undefined);
		}
		return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
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
