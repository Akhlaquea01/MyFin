import { db, type TagRow } from './db';
import { putEncrypted, decryptRows } from './encryptedTable';
import { blindIndex } from '../crypto/cryptoService';
import { getBlindIndexSalt } from './blindIndexSalt';
import type { Tag } from '../../domain/entities';

export const TagRepository = {
	async getOrCreate(key: CryptoKey, name: string): Promise<Tag> {
		const trimmed = name.trim();
		// Digest, not the name — the indexed column is unencrypted on disk.
		const nameHash = await blindIndex(trimmed, await getBlindIndexSalt());
		const existingRow = await db.tags.where('nameHash').equals(nameHash).first();
		if (existingRow) {
			return (await decryptRows<TagRow, Tag>(key, [existingRow]))[0];
		}
		const now = Date.now();
		const tag: Tag = { id: crypto.randomUUID(), name: trimmed, createdAt: now, updatedAt: now };
		await putEncrypted(db.tags, key, tag, { nameHash });
		return tag;
	},

	async list(key: CryptoKey): Promise<Tag[]> {
		const rows = await db.tags.toArray();
		return decryptRows<TagRow, Tag>(key, rows);
	}
};

export const TransactionTagRepository = {
	async setTags(transactionId: string, tagIds: string[]): Promise<void> {
		await db.transaction('rw', db.transactionTags, async () => {
			await db.transactionTags.where('transactionId').equals(transactionId).delete();
			await db.transactionTags.bulkAdd(
				tagIds.map((tagId) => ({ id: crypto.randomUUID(), transactionId, tagId }))
			);
		});
	},

	async getTagIds(transactionId: string): Promise<string[]> {
		const rows = await db.transactionTags.where('transactionId').equals(transactionId).toArray();
		return rows.map((r) => r.tagId);
	}
};
