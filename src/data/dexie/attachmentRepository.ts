import { db, type AttachmentRow } from './db';
import { encryptRow, decryptRows } from './encryptedTable';
import type { Attachment } from '../../domain/entities';

const MAX_ATTACHMENTS_PER_TRANSACTION = 5;

export const AttachmentRepository = {
	async create(
		key: CryptoKey,
		input: { transactionId: string; mimeType: string; data: string; sizeBytes: number }
	): Promise<Attachment> {
		const now = Date.now();
		const attachment: Attachment = {
			id: crypto.randomUUID(),
			transactionId: input.transactionId,
			mimeType: input.mimeType,
			data: input.data,
			sizeBytes: input.sizeBytes,
			createdAt: now,
			updatedAt: now
		};
		// Pre-encrypted outside the transaction (Web Crypto breaks Dexie's transaction zone —
		// see encryptedTable.ts), so the count-check-write below is one atomic Dexie
		// transaction with no async gap two concurrent calls could both slip through.
		const row = await encryptRow<AttachmentRow, Attachment>(key, attachment, {
			transactionId: attachment.transactionId
		});

		await db.transaction('rw', db.attachments, async () => {
			const existingCount = await db.attachments
				.where('transactionId')
				.equals(input.transactionId)
				.count();
			if (existingCount >= MAX_ATTACHMENTS_PER_TRANSACTION) {
				throw new Error(
					`A transaction can have at most ${MAX_ATTACHMENTS_PER_TRANSACTION} attachments.`
				);
			}
			await db.attachments.put(row);
		});
		return attachment;
	},

	// `_key` is unused (direct removal needs no decryption) but kept for signature symmetry
	// with the rest of this repository's methods.
	async remove(_key: CryptoKey, id: string): Promise<void> {
		await db.attachments.delete(id);
	},

	async listForTransaction(key: CryptoKey, transactionId: string): Promise<Attachment[]> {
		const rows = await db.attachments.where('transactionId').equals(transactionId).toArray();
		return decryptRows<AttachmentRow, Attachment>(key, rows);
	},

	/**
	 * Bulk "has an attachment" lookup for a window of transaction ids — a single query, not
	 * one per id (research.md §4), so the caller can populate a per-row indicator without
	 * reintroducing the N-queries-per-render problem TransactionsPage's virtualization
	 * already avoids.
	 */
	async countsForTransactions(
		_key: CryptoKey,
		transactionIds: string[]
	): Promise<Record<string, number>> {
		if (transactionIds.length === 0) return {};
		const rows = await db.attachments.where('transactionId').anyOf(transactionIds).toArray();
		const counts: Record<string, number> = {};
		for (const row of rows) {
			counts[row.transactionId] = (counts[row.transactionId] ?? 0) + 1;
		}
		return counts;
	},

	async purgeForTransaction(_key: CryptoKey, transactionId: string): Promise<void> {
		await db.attachments.where('transactionId').equals(transactionId).delete();
	},

	async list(key: CryptoKey): Promise<Attachment[]> {
		const rows = await db.attachments.toArray();
		return decryptRows<AttachmentRow, Attachment>(key, rows);
	}
};

