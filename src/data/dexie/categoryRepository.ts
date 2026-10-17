import { db, type CategoryRow, type TransactionSplitRow } from './db';
import { putEncrypted, getDecrypted, decryptRows, encryptRow } from './encryptedTable';
import { nullableIdIndex } from './indexable';
import { UNCATEGORIZED_CATEGORY_ID } from './transactionRepository';
import type { Category, CategoryKind, TransactionSplit } from '../../domain/entities';

export type NewCategory = {
	name: string;
	parentId?: string | null;
	icon?: string | null;
	color?: string | null;
	kind?: CategoryKind;
};

export const CategoryRepository = {
	async create(key: CryptoKey, input: NewCategory): Promise<Category> {
		const now = Date.now();
		const category: Category = {
			id: crypto.randomUUID(),
			name: input.name,
			parentId: input.parentId ?? null,
			icon: input.icon ?? null,
			// Written only when set, so a category that uses the automatic colour and has no kind keeps
			// the shape it always had.
			...(input.color ? { color: input.color } : {}),
			...(input.kind ? { kind: input.kind } : {}),
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

	/**
	 * Re-files every split of category `fromId` under `toId`, in one write. Returns how many moved.
	 * The building block of both deleting a category (its transactions become uncategorized) and
	 * merging it into another.
	 */
	async reassignSplits(key: CryptoKey, fromId: string, toId: string): Promise<number> {
		const splits = await decryptRows<TransactionSplitRow, TransactionSplit>(
			key,
			await db.transactionSplits.where('categoryId').equals(fromId).toArray()
		);
		if (splits.length === 0) return 0;
		const refiled = await Promise.all(
			splits.map((split) =>
				encryptRow<TransactionSplitRow, TransactionSplit>(
					key,
					{ ...split, categoryId: toId },
					{ transactionId: split.transactionId, categoryId: toId }
				)
			)
		);
		await db.transactionSplits.bulkPut(refiled);
		return refiled.length;
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

	/** How many transaction splits, budgets and recurring rules point at the category, counted on
	 *  their indexes without decrypting anything. */
	async countReferences(
		id: string
	): Promise<{ splits: number; budgets: number; recurring: number }> {
		const [splits, budgets, recurring] = await Promise.all([
			db.transactionSplits.where('categoryId').equals(id).count(),
			db.budgets.where('categoryId').equals(id).count(),
			db.recurringRules.where('categoryId').equals(id).count()
		]);
		return { splits, budgets, recurring };
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
