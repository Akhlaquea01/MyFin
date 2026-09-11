import { db, type MerchantRow, type MerchantAliasRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import { deletedAtIndex, NOT_DELETED } from './indexable';
import { blindIndex } from '../crypto/cryptoService';
import { getBlindIndexSalt } from './blindIndexSalt';
import type { Merchant, MerchantAlias } from '../../domain/entities';

export const MerchantRepository = {
	async create(key: CryptoKey, name: string): Promise<Merchant> {
		const now = Date.now();
		const merchant: Merchant = {
			id: crypto.randomUUID(),
			name,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};
		await putEncrypted(db.merchants, key, merchant, { deletedAt: NOT_DELETED });
		return merchant;
	},

	async getById(key: CryptoKey, id: string): Promise<Merchant | null> {
		return (await getDecrypted<MerchantRow, Merchant>(db.merchants, key, id)) ?? null;
	},

	async list(key: CryptoKey): Promise<Merchant[]> {
		const rows = await db.merchants.filter((row) => row.deletedAt === NOT_DELETED).toArray();
		return decryptRows<MerchantRow, Merchant>(key, rows);
	},

	async rename(key: CryptoKey, id: string, name: string): Promise<Merchant> {
		const existing = await this.getById(key, id);
		if (!existing) throw new Error(`Merchant ${id} not found`);
		const updated: Merchant = { ...existing, name, updatedAt: Date.now() };
		await putEncrypted(db.merchants, key, updated, {
			deletedAt: deletedAtIndex(updated.deletedAt)
		});
		return updated;
	}
};

export const MerchantAliasRepository = {
	async create(key: CryptoKey, merchantId: string, aliasText: string): Promise<MerchantAlias> {
		const now = Date.now();
		const alias: MerchantAlias = {
			id: crypto.randomUUID(),
			merchantId,
			aliasText,
			createdAt: now,
			updatedAt: now
		};
		// Only the digest goes in the indexed column; the alias text itself is inside
		// `encryptedData` like every other field.
		const aliasHash = await blindIndex(aliasText, await getBlindIndexSalt());
		await putEncrypted(db.merchantAliases, key, alias, { merchantId, aliasHash });
		return alias;
	},

	/** Case-insensitive lookup used by the Quick Add parser to resolve raw text to a known
	 *  merchant. Matches on the salted digest — `blindIndex` lowercases and trims, which is
	 *  what made the previous `equalsIgnoreCase` comparison case-insensitive. */
	async findByAliasText(key: CryptoKey, aliasText: string): Promise<MerchantAlias | null> {
		const aliasHash = await blindIndex(aliasText, await getBlindIndexSalt());
		const match = await db.merchantAliases.where('aliasHash').equals(aliasHash).first();
		if (!match) return null;
		const decrypted = await decryptRows<MerchantAliasRow, MerchantAlias>(key, [match]);
		return decrypted[0] ?? null;
	},

	async listForMerchant(key: CryptoKey, merchantId: string): Promise<MerchantAlias[]> {
		const rows = await db.merchantAliases.where('merchantId').equals(merchantId).toArray();
		return decryptRows<MerchantAliasRow, MerchantAlias>(key, rows);
	}
};
