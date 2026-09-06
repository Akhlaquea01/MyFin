import { db, type TagRow } from './db';
import { putEncrypted, decryptRows } from './encryptedTable';
import type { Tag } from '../../domain/entities';

export const TagRepository = {
	async getOrCreate(key: CryptoKey, name: string): Promise<Tag> {
		const trimmed = name.trim();
		const existingRow = await db.tags.where('name').equalsIgnoreCase(trimmed).first();
		if (existingRow) {
			return (await decryptRows<TagRow, Tag>(key, [existingRow]))[0];
		}
		const now = Date.now();
		const tag: Tag = { id: crypto.randomUUID(), name: trimmed, createdAt: now, updatedAt: now };
		await putEncrypted(db.tags, key, tag, { name: trimmed });
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
