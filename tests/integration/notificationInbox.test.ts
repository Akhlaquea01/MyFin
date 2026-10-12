import { describe, it, expect, beforeEach, vi } from 'vitest';

const notify = vi.hoisted(() => ({
	permission: 'denied' as 'granted' | 'denied' | 'default' | 'unsupported',
	shown: [] as { title: string; route?: string }[]
}));
vi.mock('../../src/lib/notify', () => ({
	getNotifyPermission: async () => notify.permission,
	showNotification: async (title: string, _body: string, _tag: string, route?: string) => {
		notify.shown.push({ title, route });
		return true;
	}
}));

import { db } from '../../src/data/dexie/db';
import { AccountRepository } from '../../src/data/dexie/accountRepository';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { RecurringRepository } from '../../src/data/dexie/recurringRepository';
import {
	INBOX_LIMIT,
	NotificationInboxRepository
} from '../../src/data/dexie/notificationInboxRepository';
import { UnreadableCaptureRepository } from '../../src/data/dexie/unreadableCaptureRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { runNotificationCheck } from '../../src/domain/notifications/runNotificationCheck';
import { changePin } from '../../src/data/io/changePinService';
import {
	createBackup,
	deriveDataKeyForPayload,
	restoreBackup,
	validateAndDecryptBackup
} from '../../src/data/io/backupService';
import { clearAllTables } from '../../src/data/dexie/clearAllTables';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

const item = (n: number) => ({
	dedupeKey: `recurring:${n}`,
	kind: 'recurring' as const,
	title: `Upcoming: Bill ${n}`,
	body: 'Due 2026-10-13',
	route: '/recurring/upcoming'
});

describe('Alerts inbox', () => {
	const pin = '482915';
	let key: CryptoKey;
	let encryptionSalt: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		notify.permission = 'denied';
		notify.shown = [];
		encryptionSalt = randomSaltBase64();
		key = await deriveEncryptionKey(pin, encryptionSalt);
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin(pin, pinSalt),
			pinSalt,
			encryptionSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
	});

	describe('repository', () => {
		it('lists an occurrence once, newest first, and counts the unread without decrypting', async () => {
			const first = await NotificationInboxRepository.addIfMissing(key, item(1));
			const duplicate = await NotificationInboxRepository.addIfMissing(key, item(1));
			await NotificationInboxRepository.addIfMissing(key, item(2));

			expect(first).not.toBeNull();
			expect(duplicate).toBeNull();
			expect(await NotificationInboxRepository.countUnread()).toBe(2);
			const listed = await NotificationInboxRepository.list(key);
			expect(listed.map((i) => i.dedupeKey)).toEqual(['recurring:2', 'recurring:1']);
		});

		it('marks one or all as read, and the count follows', async () => {
			const a = (await NotificationInboxRepository.addIfMissing(key, item(1)))!;
			await NotificationInboxRepository.addIfMissing(key, item(2));

			await NotificationInboxRepository.markRead(key, a.id);
			expect(await NotificationInboxRepository.countUnread()).toBe(1);

			await NotificationInboxRepository.markAllRead(key);
			expect(await NotificationInboxRepository.countUnread()).toBe(0);
			const listed = await NotificationInboxRepository.list(key);
			expect(listed.every((i) => i.readAt !== null)).toBe(true);
		});

		it('keeps only the most recent INBOX_LIMIT entries', async () => {
			for (let n = 0; n < INBOX_LIMIT + 5; n++) {
				await NotificationInboxRepository.addIfMissing(key, item(n));
			}
			const listed = await NotificationInboxRepository.list(key);
			expect(listed).toHaveLength(INBOX_LIMIT);
			expect(listed.some((i) => i.dedupeKey === `recurring:${INBOX_LIMIT + 4}`)).toBe(true);
		});

		it('removes one and clears all', async () => {
			const a = (await NotificationInboxRepository.addIfMissing(key, item(1)))!;
			await NotificationInboxRepository.addIfMissing(key, item(2));
			await NotificationInboxRepository.remove(a.id);
			expect(await NotificationInboxRepository.list(key)).toHaveLength(1);
			await NotificationInboxRepository.clear();
			expect(await NotificationInboxRepository.list(key)).toHaveLength(0);
		});
	});

	describe('the unlock-time check', () => {
		async function dueTomorrow() {
			const account = await AccountRepository.create(key, {
				name: 'Checking',
				type: 'bank',
				openingBalance: 100000,
				creditLimit: null,
				billingCycleDay: null
			});
			const category = await CategoryRepository.create(key, { name: 'Rent' });
			// Weekly, on tomorrow's weekday: due within the default one-day lead time.
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			await RecurringRepository.create(key, {
				accountId: account.id,
				categoryId: category.id,
				amount: -50000,
				frequency: 'weekly',
				dayOfPeriod: tomorrow.getDay()
			});
		}

		it('lists a due reminder in the inbox even when the system will not show it', async () => {
			await dueTomorrow();
			notify.permission = 'denied';

			const result = await runNotificationCheck(key);

			expect(result.dispatched).toHaveLength(0);
			expect(notify.shown).toHaveLength(0);
			const listed = await NotificationInboxRepository.list(key);
			expect(listed).toHaveLength(1);
			expect(listed[0]).toMatchObject({
				kind: 'recurring',
				route: '/recurring/upcoming',
				readAt: null
			});
		});

		it('does not list the same occurrence again on the next unlock, and shows it once when allowed', async () => {
			await dueTomorrow();
			notify.permission = 'granted';

			await runNotificationCheck(key);
			await runNotificationCheck(key);

			expect(await NotificationInboxRepository.list(key)).toHaveLength(1);
			expect(notify.shown).toHaveLength(1);
			expect(notify.shown[0].route).toBe('/recurring/upcoming');
		});
	});

	describe('across a PIN change and a backup restore', () => {
		async function seed() {
			await NotificationInboxRepository.addIfMissing(key, item(1));
			await UnreadableCaptureRepository.add(key, {
				channel: 'sms',
				sender: 'VM-HDFCBK',
				receivedAt: 1_700_000_000_000,
				text: 'Your credit limit is Rs.50,000'
			});
		}

		it('survives a PIN change', async () => {
			await seed();

			await changePin(key, pin, '739204');

			const profile = (await UserProfileRepository.get())!;
			const newKey = await deriveEncryptionKey('739204', profile.encryptionSalt);
			expect(await NotificationInboxRepository.list(newKey)).toHaveLength(1);
			const unreadable = await UnreadableCaptureRepository.list(newKey);
			expect(unreadable.map((u) => u.text)).toEqual(['Your credit limit is Rs.50,000']);
		});

		it('is carried by a backup and restored with it', async () => {
			await seed();
			const backup = await createBackup(key, encryptionSalt, pin);
			const { payload } = await validateAndDecryptBackup(backup, pin);
			await clearAllTables();

			const dataKey = await deriveDataKeyForPayload(payload, pin, backup.kdf.salt);
			await restoreBackup(dataKey, payload);

			expect(await NotificationInboxRepository.list(dataKey)).toHaveLength(1);
			expect(await NotificationInboxRepository.countUnread()).toBe(1);
			expect(await UnreadableCaptureRepository.list(dataKey)).toHaveLength(1);
		});

		it('restores an older backup that has neither list without error', async () => {
			await seed();
			const backup = await createBackup(key, encryptionSalt, pin);
			const { payload } = await validateAndDecryptBackup(backup, pin);
			delete payload.exportedEntities.notificationInbox;
			delete payload.exportedEntities.unreadableCaptures;

			const dataKey = await deriveDataKeyForPayload(payload, pin, backup.kdf.salt);
			await restoreBackup(dataKey, payload);

			expect(await NotificationInboxRepository.list(dataKey)).toHaveLength(0);
			expect(await UnreadableCaptureRepository.list(dataKey)).toHaveLength(0);
		});
	});

	describe('unreadable captures', () => {
		it('lists newest first and trims to its limit', async () => {
			for (let n = 0; n < 105; n++) {
				await UnreadableCaptureRepository.add(key, {
					channel: 'notification',
					sender: 'GPay',
					receivedAt: 1_700_000_000_000 + n,
					text: `message ${n}`
				});
			}
			const listed = await UnreadableCaptureRepository.list(key);
			expect(listed).toHaveLength(100);
			expect(listed[0].text).toBe('message 104');
			expect(await UnreadableCaptureRepository.count()).toBe(100);
		});
	});
});
