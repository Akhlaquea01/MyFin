import { db, type UnreadableCaptureRow } from './db';
import { decryptRows, putEncrypted } from './encryptedTable';
import type { CaptureChannel, UnreadableCapture } from '../../domain/entities';

/** Enough to catch up on after a long absence; beyond this the oldest are dropped. */
export const UNREADABLE_CAPTURE_LIMIT = 100;

export interface NewUnreadableCapture {
	channel: CaptureChannel;
	sender: string;
	receivedAt: number;
	text: string;
}

export const UnreadableCaptureRepository = {
	async add(key: CryptoKey, input: NewUnreadableCapture): Promise<UnreadableCapture> {
		const now = Date.now();
		const item: UnreadableCapture = {
			id: crypto.randomUUID(),
			...input,
			createdAt: now,
			updatedAt: now
		};
		await putEncrypted<UnreadableCaptureRow, UnreadableCapture>(db.unreadableCaptures, key, item, {
			receivedAt: item.receivedAt
		});
		const total = await db.unreadableCaptures.count();
		if (total > UNREADABLE_CAPTURE_LIMIT) {
			const overflow = await db.unreadableCaptures
				.orderBy('receivedAt')
				.limit(total - UNREADABLE_CAPTURE_LIMIT)
				.primaryKeys();
			await db.unreadableCaptures.bulkDelete(overflow);
		}
		return item;
	},

	/** Newest first. */
	async list(key: CryptoKey): Promise<UnreadableCapture[]> {
		const rows = await db.unreadableCaptures.toArray();
		const items = await decryptRows<UnreadableCaptureRow, UnreadableCapture>(key, rows);
		return items.sort((a, b) => b.receivedAt - a.receivedAt);
	},

	async count(): Promise<number> {
		return db.unreadableCaptures.count();
	},

	async remove(id: string): Promise<void> {
		await db.unreadableCaptures.delete(id);
	},

	async clear(): Promise<void> {
		await db.unreadableCaptures.clear();
	}
};
