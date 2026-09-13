import { db, type TagRow } from './db';
import { encryptRow, decryptRows } from './encryptedTable';
import { blindIndex } from '../crypto/cryptoService';
import { getBlindIndexSalt } from './blindIndexSalt';
import { NOT_DELETED } from './indexable';
import { distinctTagIdsInUse, normalizeTagText, type TagOption } from '../../domain/transactions/tagFilterEngine';
import type { Tag, TransactionTag } from '../../domain/entities';

export const TagRepository = {
	async getOrCreate(key: CryptoKey, name: string): Promise<Tag> {
		const trimmed = name.trim();
		// Digest, not the name — the indexed column is unencrypted on disk.
		const nameHash = await blindIndex(trimmed, await getBlindIndexSalt());
		const now = Date.now();
		const tag: Tag = { id: crypto.randomUUID(), name: trimmed, createdAt: now, updatedAt: now };
		// Pre-encrypted outside the transaction (Web Crypto breaks Dexie's transaction zone —
		// see encryptedTable.ts), so the check-then-write below is one atomic Dexie transaction:
		// two concurrent calls for the same name can no longer both pass the check and create
		// duplicate tags before either writes. Decryption also happens strictly after the
		// transaction settles, not inside it — an await inside the callback, even a Web Crypto
		// call in the read-only branch, can desync Dexie's zone tracking across two genuinely
		// concurrent transactions and throw a PrematureCommitError on an unrelated caller's put.
		const newRow = await encryptRow<TagRow, Tag>(key, tag, { nameHash });

		const resultRow = await db.transaction('rw', db.tags, async () => {
			const existingRow = await db.tags.where('nameHash').equals(nameHash).first();
			if (existingRow) return existingRow;
			await db.tags.put(newRow);
			return newRow;
		});
		return (await decryptRows<TagRow, Tag>(key, [resultRow]))[0];
	},

	async list(key: CryptoKey): Promise<Tag[]> {
		const rows = await db.tags.toArray();
		return decryptRows<TagRow, Tag>(key, rows);
	},

	/**
	 * Tags currently attached to at least one non-deleted transaction, sorted case-insensitively
	 * by name — the pick-list source for the tag filter (spec 012, FR-004/FR-009). A tag whose
	 * only transactions are soft-deleted is excluded.
	 */
	async listInUse(key: CryptoKey): Promise<TagOption[]> {
		const transactionTagRows = await db.transactionTags.toArray();
		const liveTransactionIds = new Set(
			(await db.transactions.where('deletedAt').equals(NOT_DELETED).primaryKeys()) as string[]
		);
		const inUseIds = distinctTagIdsInUse(transactionTagRows, liveTransactionIds);
		const tags = (await TagRepository.list(key)).filter((t) => inUseIds.has(t.id));
		return tags
			.map((t) => ({ id: t.id, name: t.name }))
			.sort((a, b) => normalizeTagText(a.name).localeCompare(normalizeTagText(b.name)));
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
	},

	async list(): Promise<TransactionTag[]> {
		const rows = await db.transactionTags.toArray();
		return rows.map((r) => ({ transactionId: r.transactionId, tagId: r.tagId }));
	}
};

