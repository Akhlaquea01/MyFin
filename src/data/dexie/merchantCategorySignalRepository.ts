import { db, type MerchantCategorySignalRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import type { MerchantCategorySignal } from '../../domain/entities';

/**
 * Purely mechanical CRUD over the `merchantCategorySignals` table — every algorithmic
 * decision (capping the streak at `MIN_STREAK`, deriving a suggestion) belongs to
 * `src/domain/categorization/` instead (Constitution Principle III: Data must not import
 * Domain logic, only the reverse), which is why `set` takes an already-computed array
 * rather than an "append one category" operation.
 */
export const MerchantCategorySignalRepository = {
	async get(key: CryptoKey, merchantId: string): Promise<MerchantCategorySignal | null> {
		return (
			(await getDecrypted<MerchantCategorySignalRow, MerchantCategorySignal>(
				db.merchantCategorySignals,
				key,
				merchantId
			)) ?? null
		);
	},

	/** Overwrites `merchantId`'s full `recentCategoryIds` array; creates the row on first
	 *  write. Capping/ordering is the caller's decision (see `recordConfirmation`). */
	async set(
		key: CryptoKey,
		merchantId: string,
		recentCategoryIds: string[]
	): Promise<MerchantCategorySignal> {
		const existing = await this.get(key, merchantId);
		const now = Date.now();
		const updated: MerchantCategorySignal = {
			id: merchantId,
			recentCategoryIds,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now
		};
		await putEncrypted(db.merchantCategorySignals, key, updated, {});
		return updated;
	},

	/** Clears a merchant's signal (FR-006's "dismiss/reset") — pre-filling stops until a
	 *  fresh streak re-forms. `_key` is unused (a direct removal needs no decryption) but
	 *  kept for signature symmetry with the rest of this repository's methods. */
	async reset(_key: CryptoKey, merchantId: string): Promise<void> {
		await db.merchantCategorySignals.delete(merchantId);
	},

	/** Every signal row, decrypted — no algorithmic filtering; see
	 *  `resolveCategorization.ts`'s `listSuggestions` for the derived, user-facing view. */
	async listAll(key: CryptoKey): Promise<MerchantCategorySignal[]> {
		const rows = await db.merchantCategorySignals.toArray();
		return decryptRows<MerchantCategorySignalRow, MerchantCategorySignal>(key, rows);
	}
};
