import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../src/data/dexie/db';
import { CategoryRepository } from '../../src/data/dexie/categoryRepository';
import { STARTER_CATEGORIES, addStarterCategories } from '../../src/data/io/starterCategories';
import { deriveEncryptionKey, randomSaltBase64 } from '../../src/data/crypto/cryptoService';

describe('addStarterCategories', () => {
	let key: CryptoKey;

	beforeEach(async () => {
		await db.delete();
		await db.open();
		key = await deriveEncryptionKey('482915', randomSaltBase64());
	});

	const total = STARTER_CATEGORIES.reduce((n, c) => n + 1 + (c.children?.length ?? 0), 0);

	it('adds the whole starter set to an empty ledger, nesting subcategories under their parent', async () => {
		const added = await addStarterCategories(key);

		expect(added).toBe(total);
		const all = await CategoryRepository.list(key);
		const food = all.find((c) => c.name === 'Food & Dining')!;
		expect(food.parentId).toBeNull();
		const groceries = all.find((c) => c.name === 'Groceries')!;
		expect(groceries.parentId).toBe(food.id);
	});

	it('is idempotent: running it again adds nothing', async () => {
		await addStarterCategories(key);

		expect(await addStarterCategories(key)).toBe(0);
		expect(await CategoryRepository.list(key)).toHaveLength(total);
	});

	it('reuses a category the user already made, whatever its capitalisation', async () => {
		await CategoryRepository.create(key, { name: 'food & dining' });

		const added = await addStarterCategories(key);

		expect(added).toBe(total - 1);
		const all = await CategoryRepository.list(key);
		expect(all.filter((c) => c.name.toLowerCase() === 'food & dining')).toHaveLength(1);
		const groceries = all.find((c) => c.name === 'Groceries')!;
		expect(all.find((c) => c.id === groceries.parentId)?.name).toBe('food & dining');
	});
});
