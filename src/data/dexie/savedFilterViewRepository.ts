import { db, type SavedFilterViewRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import type { SavedFilterView } from '../../domain/entities';

export type NewSavedFilterView = Omit<SavedFilterView, 'id' | 'createdAt' | 'updatedAt'>;

export const SavedFilterViewRepository = {
	async create(key: CryptoKey, input: NewSavedFilterView): Promise<SavedFilterView> {
		const now = Date.now();
		const view: SavedFilterView = {
			...input,
			id: crypto.randomUUID(),
			createdAt: now,
			updatedAt: now
		};
		await putEncrypted(db.savedFilterViews, key, view, {
			createdAt: now
		});
		return view;
	},

	async update(key: CryptoKey, id: string, changes: Partial<SavedFilterView>): Promise<SavedFilterView> {
		const existing = await getDecrypted<SavedFilterViewRow, SavedFilterView>(db.savedFilterViews, key, id);
		if (!existing) throw new Error(`SavedFilterView ${id} not found`);
		const updated: SavedFilterView = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.savedFilterViews, key, updated, {
			createdAt: updated.createdAt
		});
		return updated;
	},

	async delete(id: string): Promise<void> {
		await db.savedFilterViews.delete(id);
	},

	async getById(key: CryptoKey, id: string): Promise<SavedFilterView | null> {
		return (await getDecrypted<SavedFilterViewRow, SavedFilterView>(db.savedFilterViews, key, id)) ?? null;
	},

	async list(key: CryptoKey): Promise<SavedFilterView[]> {
		const rows = await db.savedFilterViews.orderBy('createdAt').toArray();
		return decryptRows<SavedFilterViewRow, SavedFilterView>(key, rows);
	},

	async findByName(key: CryptoKey, name: string): Promise<SavedFilterView | null> {
		const all = await this.list(key);
		return all.find((v) => v.name.toLowerCase() === name.toLowerCase()) ?? null;
	}
};
