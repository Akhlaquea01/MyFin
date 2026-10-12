import { db, type NotificationInboxRow } from './db';
import { decryptRows, getDecrypted, putEncrypted } from './encryptedTable';
import type { InboxNotification, InboxNotificationKind } from '../../domain/entities';

/** The list is a convenience, not a ledger: only the most recent entries are kept. */
export const INBOX_LIMIT = 100;

export interface NewInboxNotification {
	dedupeKey: string;
	kind: InboxNotificationKind;
	title: string;
	body: string;
	route: string;
}

async function put(key: CryptoKey, item: InboxNotification): Promise<void> {
	await putEncrypted<NotificationInboxRow, InboxNotification>(db.notificationInbox, key, item, {
		dedupeKey: item.dedupeKey,
		createdAt: item.createdAt,
		isRead: item.readAt === null ? 0 : 1
	});
}

export const NotificationInboxRepository = {
	/**
	 * Lists a reminder once. Returns the new entry, or null when this occurrence is already there
	 * (checked on the indexed key alone — nothing is decrypted). Trims the list to `INBOX_LIMIT`,
	 * dropping the oldest.
	 */
	async addIfMissing(
		key: CryptoKey,
		input: NewInboxNotification
	): Promise<InboxNotification | null> {
		const existing = await db.notificationInbox.where('dedupeKey').equals(input.dedupeKey).first();
		if (existing) return null;
		const now = Date.now();
		const item: InboxNotification = {
			id: crypto.randomUUID(),
			...input,
			readAt: null,
			createdAt: now,
			updatedAt: now
		};
		await put(key, item);
		const total = await db.notificationInbox.count();
		if (total > INBOX_LIMIT) {
			const overflow = await db.notificationInbox
				.orderBy('createdAt')
				.limit(total - INBOX_LIMIT)
				.primaryKeys();
			await db.notificationInbox.bulkDelete(overflow);
		}
		return item;
	},

	/** Newest first. */
	async list(key: CryptoKey): Promise<InboxNotification[]> {
		const rows = await db.notificationInbox.toArray();
		const items = await decryptRows<NotificationInboxRow, InboxNotification>(key, rows);
		return items.sort((a, b) => b.createdAt - a.createdAt);
	},

	/** How many are unread, read off the indexed column — no decryption, cheap enough for a badge. */
	async countUnread(): Promise<number> {
		return db.notificationInbox.where('isRead').equals(0).count();
	},

	async markRead(key: CryptoKey, id: string): Promise<void> {
		const item = await getDecrypted<NotificationInboxRow, InboxNotification>(
			db.notificationInbox,
			key,
			id
		);
		if (!item || item.readAt !== null) return;
		await put(key, { ...item, readAt: Date.now(), updatedAt: Date.now() });
	},

	async markAllRead(key: CryptoKey): Promise<void> {
		const unreadIds = await db.notificationInbox.where('isRead').equals(0).primaryKeys();
		for (const id of unreadIds) await this.markRead(key, id as string);
	},

	async remove(id: string): Promise<void> {
		await db.notificationInbox.delete(id);
	},

	async clear(): Promise<void> {
		await db.notificationInbox.clear();
	}
};
