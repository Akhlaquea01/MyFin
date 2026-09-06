import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import {
	NotificationPreferenceRepository,
	NotifiedItemRepository
} from '../../src/data/dexie/notificationRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('NotificationPreferenceRepository + NotifiedItemRepository against Dexie', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('4444', randomSaltBase64());
	});

	it('returns the documented default (enabled: true) when nothing is stored yet', async () => {
		const pref = await NotificationPreferenceRepository.get(key);
		expect(pref.enabled).toBe(true);
		expect(pref.reminderLeadDays).toBe(1);
		expect(pref.budgetThresholdPercent).toBe(80);
		expect(pref.permissionPromptDismissed).toBe(false);
	});

	it('does not persist the default merely by reading it', async () => {
		await NotificationPreferenceRepository.get(key);
		expect(await db.notificationPreferences.get('local-user')).toBeUndefined();
	});

	it('persists a saved preference and returns it on a later get()', async () => {
		await NotificationPreferenceRepository.save(key, {
			enabled: false,
			reminderLeadDays: 3,
			budgetThresholdPercent: 50,
			permissionPromptDismissed: true
		});

		const pref = await NotificationPreferenceRepository.get(key);
		expect(pref.enabled).toBe(false);
		expect(pref.reminderLeadDays).toBe(3);
		expect(pref.budgetThresholdPercent).toBe(50);
		expect(pref.permissionPromptDismissed).toBe(true);
	});

	it('reports a key as not existing until it has been created', async () => {
		expect(await NotifiedItemRepository.exists(key, 'recurring:some-event-id')).toBe(false);
		await NotifiedItemRepository.create(key, { key: 'recurring:some-event-id' });
		expect(await NotifiedItemRepository.exists(key, 'recurring:some-event-id')).toBe(true);
	});
});
