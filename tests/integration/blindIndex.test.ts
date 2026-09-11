import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import {
	MerchantRepository,
	MerchantAliasRepository
} from '../../src/data/dexie/merchantRepository';
import { TagRepository } from '../../src/data/dexie/tagRepository';
import { UserProfileRepository } from '../../src/data/dexie/userProfileRepository';
import { resetBlindIndexSaltCache } from '../../src/data/dexie/blindIndexSalt';
import { runBlindIndexMaintenance } from '../../src/data/dexie/blindIndexMaintenance';
import {
	deriveEncryptionKey,
	randomSaltBase64,
	hashPin,
	blindIndex
} from '../../src/data/crypto/cryptoService';

/**
 * Constitution Principle II: user-authored text must not sit unencrypted on disk. IndexedDB
 * indexes are stored in the clear, so `merchantAliases.aliasText` and `tags.name` — which held
 * raw bank-statement descriptions — were a hole in that guarantee. These tests assert the
 * plaintext is gone from the index and that lookups still behave.
 */
describe('blind-indexed lookups', () => {
	const pin = '482915';
	let key: CryptoKey;
	let encryptionSalt: string;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		resetBlindIndexSaltCache();
		encryptionSalt = randomSaltBase64();
		key = await deriveEncryptionKey(pin, encryptionSalt);
		const pinSalt = randomSaltBase64();
		await UserProfileRepository.create({
			pinVerifierHash: await hashPin(pin, pinSalt),
			pinSalt,
			encryptionSalt,
			biometricEnabled: false,
			autoLockTimeoutMs: 300_000,
			storagePersisted: false
		});
	});

	it('stores no readable alias text in the index', async () => {
		const merchant = await MerchantRepository.create(key, 'Dr Rakesh Mehta Oncology');
		await MerchantAliasRepository.create(key, merchant.id, 'UPI/DR/402913/DrRakeshMehta/oncology');

		const rows = await db.merchantAliases.toArray();
		expect(rows).toHaveLength(1);
		expect(rows[0].aliasText).toBeUndefined();
		expect(rows[0].aliasHash).toMatch(/^[0-9a-f]{64}$/);

		// Nothing anywhere in the row's indexed columns reveals the description.
		const indexedOnly = JSON.stringify({
			id: rows[0].id,
			merchantId: rows[0].merchantId,
			aliasHash: rows[0].aliasHash
		});
		expect(indexedOnly.toLowerCase()).not.toContain('rakesh');
		expect(indexedOnly.toLowerCase()).not.toContain('oncology');
	});

	it('stores no readable tag name in the index', async () => {
		await TagRepository.getOrCreate(key, 'Therapy');
		const rows = await db.tags.toArray();
		expect(rows[0].name).toBeUndefined();
		expect(rows[0].nameHash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('still resolves aliases case-insensitively', async () => {
		const merchant = await MerchantRepository.create(key, 'Swiggy');
		await MerchantAliasRepository.create(key, merchant.id, 'SWIGGY BANGALORE');

		for (const probe of ['SWIGGY BANGALORE', 'swiggy bangalore', '  Swiggy Bangalore  ']) {
			const found = await MerchantAliasRepository.findByAliasText(key, probe);
			expect(found?.merchantId).toBe(merchant.id);
		}
		expect(await MerchantAliasRepository.findByAliasText(key, 'Zomato')).toBeNull();
	});

	it('still de-duplicates tags case-insensitively', async () => {
		const first = await TagRepository.getOrCreate(key, 'Groceries');
		const second = await TagRepository.getOrCreate(key, 'groceries');
		expect(second.id).toBe(first.id);
		expect(await db.tags.count()).toBe(1);
	});

	it('produces different digests on different installations', async () => {
		const saltA = randomSaltBase64();
		const saltB = randomSaltBase64();
		expect(await blindIndex('SWIGGY', saltA)).not.toBe(await blindIndex('SWIGGY', saltB));
		// ...and the same digest for the same input on the same installation.
		expect(await blindIndex('SWIGGY', saltA)).toBe(await blindIndex('swiggy ', saltA));
	});

	it('re-indexes pre-v8 rows on the first unlock, then leaves them alone', async () => {
		const merchant = await MerchantRepository.create(key, 'Old Merchant');
		const alias = await MerchantAliasRepository.create(key, merchant.id, 'OLD ALIAS');
		const tag = await TagRepository.getOrCreate(key, 'OldTag');

		// Simulate rows written before schema v8: plaintext in the index, no digest.
		await db.merchantAliases.put({
			...(await db.merchantAliases.get(alias.id))!,
			aliasHash: '',
			aliasText: 'OLD ALIAS'
		});
		await db.tags.put({ ...(await db.tags.get(tag.id))!, nameHash: '', name: 'OldTag' });

		// Lookups miss while the digest is absent — degraded, but never wrong.
		expect(await MerchantAliasRepository.findByAliasText(key, 'OLD ALIAS')).toBeNull();

		const first = await runBlindIndexMaintenance(key);
		expect(first.reindexed).toBe(2);

		const repaired = await db.merchantAliases.get(alias.id);
		expect(repaired?.aliasText).toBeUndefined();
		expect(await MerchantAliasRepository.findByAliasText(key, 'old alias')).not.toBeNull();
		expect((await db.tags.get(tag.id))?.name).toBeUndefined();

		// Idempotent: a second pass finds nothing left to do.
		expect((await runBlindIndexMaintenance(key)).reindexed).toBe(0);
	});
});
