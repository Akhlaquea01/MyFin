import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { DebtPlannerPreferenceRepository } from '../../src/data/dexie/debtPlannerPreferenceRepository';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('DebtPlannerPreferenceRepository against Dexie', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('7777', randomSaltBase64());
	});

	it('returns the documented default when nothing is stored yet', async () => {
		const pref = await DebtPlannerPreferenceRepository.get(key);
		expect(pref.strategy).toBe('avalanche');
		expect(pref.extraMonthlyPayment).toBe(0);
	});

	it('does not persist the default merely by reading it', async () => {
		await DebtPlannerPreferenceRepository.get(key);
		expect(await db.debtPlannerPreferences.get('local-user')).toBeUndefined();
	});

	it('persists a saved strategy/extraMonthlyPayment and returns it on a later get()', async () => {
		await DebtPlannerPreferenceRepository.save(key, {
			strategy: 'snowball',
			extraMonthlyPayment: 15000
		});

		const pref = await DebtPlannerPreferenceRepository.get(key);
		expect(pref.strategy).toBe('snowball');
		expect(pref.extraMonthlyPayment).toBe(15000);
	});

	it('keeps the original createdAt across repeated saves', async () => {
		const first = await DebtPlannerPreferenceRepository.save(key, {
			strategy: 'avalanche',
			extraMonthlyPayment: 1000
		});
		const second = await DebtPlannerPreferenceRepository.save(key, {
			strategy: 'snowball',
			extraMonthlyPayment: 2000
		});
		expect(second.createdAt).toBe(first.createdAt);
		expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
	});
});
