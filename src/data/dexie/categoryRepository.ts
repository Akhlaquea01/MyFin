import { db, type CategoryRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import { deletedAtIndex, nullableIdIndex, NOT_DELETED } from './indexable';
import type { Category } from '../../domain/entities';

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
			updatedAt: now,
			deletedAt: null
		};
		await putEncrypted(db.categories, key, category, {
			parentId: nullableIdIndex(category.parentId),
			deletedAt: NOT_DELETED
		});
		return category;
	},

	async update(key: CryptoKey, id: string, changes: Partial<Category>): Promise<Category> {
		const existing = await getDecrypted<CategoryRow, Category>(db.categories, key, id);
		if (!existing) throw new Error(`Category ${id} not found`);
		const updated: Category = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.categories, key, updated, {
			parentId: nullableIdIndex(updated.parentId),
			deletedAt: deletedAtIndex(updated.deletedAt)
		});
		return updated;
	},

	async softDelete(key: CryptoKey, id: string): Promise<void> {
		await this.update(key, id, { deletedAt: Date.now() });
	},

	async getById(key: CryptoKey, id: string): Promise<Category | null> {
		return (await getDecrypted<CategoryRow, Category>(db.categories, key, id)) ?? null;
	},

	async list(key: CryptoKey): Promise<Category[]> {
		const rows = await db.categories.filter((row) => row.deletedAt === NOT_DELETED).toArray();
		return decryptRows<CategoryRow, Category>(key, rows);
	},

	async listChildren(key: CryptoKey, parentId: string | null): Promise<Category[]> {
		const rows = await db.categories
			.where('parentId')
			.equals(nullableIdIndex(parentId))
			.filter((row) => row.deletedAt === NOT_DELETED)
			.toArray();
		return decryptRows<CategoryRow, Category>(key, rows);
	}
};
