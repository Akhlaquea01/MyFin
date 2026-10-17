import { db, type CategoryRow, type TransactionSplitRow } from './db';
import { putEncrypted, getDecrypted, decryptRows, encryptRow } from './encryptedTable';
import { nullableIdIndex } from './indexable';
import { UNCATEGORIZED_CATEGORY_ID } from './transactionRepository';
import type { Category, TransactionSplit } from '../../domain/entities';

export type NewCategory = { name: string; parentId?: string | null; icon?: string | null };

export const CategoryRepository = {
	async create(key: CryptoKey, input: NewCategory): Promise<Category> {
		const now = Date.now();
		const category: Category = {
			id: crypto.randomUUID(),
			name: input.name,
			parentId: input.parentId ?? null,
			icon: input.icon ?? null,
			createdAt: now,
			updatedAt: now
		};
		await putEncrypted(db.categories, key, category, {
			parentId: nullableIdIndex(category.parentId)
		});
		return category;
	},

	async update(key: CryptoKey, id: string, changes: Partial<Category>): Promise<Category> {
		const existing = await getDecrypted<CategoryRow, Category>(db.categories, key, id);
		if (!existing) throw new Error(`Category ${id} not found`);
		const updated: Category = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.categories, key, updated, {
			parentId: nullableIdIndex(updated.parentId)
		});
		return updated;
	},

	/** Deletes the category; its transactions fall back to "Uncategorized" rather than pointing at
	 *  a category that no longer exists. */
	async remove(key: CryptoKey, id: string): Promise<void> {
		const splits = await decryptRows<TransactionSplitRow, TransactionSplit>(
			key,
			await db.transactionSplits.where('categoryId').equals(id).toArray()
		);
		const refiled = await Promise.all(
			splits.map((split) =>
				encryptRow<TransactionSplitRow, TransactionSplit>(
					key,
					{ ...split, categoryId: UNCATEGORIZED_CATEGORY_ID },
					{ transactionId: split.transactionId, categoryId: UNCATEGORIZED_CATEGORY_ID }
				)
			)
		);
		await db.transaction('rw', db.categories, db.transactionSplits, async () => {
			await db.transactionSplits.bulkPut(refiled);
			await db.categories.delete(id);
		});
	},

	async getById(key: CryptoKey, id: string): Promise<Category | null> {
		return (await getDecrypted<CategoryRow, Category>(db.categories, key, id)) ?? null;
	},

	async list(key: CryptoKey): Promise<Category[]> {
		const rows = await db.categories.toArray();
		return decryptRows<CategoryRow, Category>(key, rows);
	},

	async listChildren(key: CryptoKey, parentId: string | null): Promise<Category[]> {
		const rows = await db.categories.where('parentId').equals(nullableIdIndex(parentId)).toArray();
		return decryptRows<CategoryRow, Category>(key, rows);
	}
};
