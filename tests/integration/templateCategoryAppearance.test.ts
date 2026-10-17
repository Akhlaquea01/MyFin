import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { importDataTemplate } from '../../src/data/io/templateService';
import type { DataTemplate } from '../../src/data/io/templateTypes';
import {
	deriveEncryptionKey,
	hashPin,
	randomSaltBase64
} from '../../src/data/crypto/cryptoService';

// A category's chosen colour and icon, and whether it is an income category, are part of how the
// user set their ledger up. They have to survive moving it to another device.
describe('templateService - category appearance', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		const encryptionSalt = randomSaltBase64();
		key = await deriveEncryptionKey('1234', encryptionSalt);
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin('1234', pinSalt),
			pinSalt,
			encryptionSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: true
		});
	});

	it('imports colour, icon and kind, for top-level categories and subcategories alike', async () => {
		const base = { createdAt: 1, updatedAt: 1 };
		const template = {
			container: 'myfin-data-template',
			templateVersion: 1,
			exportedAt: new Date().toISOString(),
			entities: {
				accounts: [],
				categories: [
					{
						id: 'c1',
						name: 'Pay',
						parentId: null,
						icon: 'briefcase',
						color: 'cat-4',
						kind: 'income',
						...base
					},
					{ id: 'c2', name: 'Bonus', parentId: 'c1', icon: 'gift', ...base },
					{ id: 'c3', name: 'Plain', parentId: null, icon: null, ...base }
				],
				merchants: [],
				merchantAliases: [],
				tags: [],
				investmentHoldings: [],
				investmentValuations: [],
				liabilities: [],
				netWorthSnapshots: [],
				savingsGoals: [],
				goalContributions: [],
				budgets: [],
				budgetItems: [],
				recurringRules: [],
				expectedEvents: [],
				categorizationRules: [],
				merchantCategorySignals: [],
				notificationPreference: null,
				debtPlannerPreference: null,
				transactions: [],
				transactionSplits: [],
				transactionTags: [],
				attachments: []
			}
		} as unknown as DataTemplate;

		await importDataTemplate(key, template);

		const all = await CategoryRepository.list(key);
		const pay = all.find((c) => c.name === 'Pay')!;
		const bonus = all.find((c) => c.name === 'Bonus')!;
		const plain = all.find((c) => c.name === 'Plain')!;
		expect(pay).toMatchObject({ icon: 'briefcase', color: 'cat-4', kind: 'income' });
		expect(bonus).toMatchObject({ icon: 'gift', parentId: pay.id });
		// A category that never had them is stored as it always was.
		expect('color' in plain).toBe(false);
		expect('kind' in plain).toBe(false);
	});
});
