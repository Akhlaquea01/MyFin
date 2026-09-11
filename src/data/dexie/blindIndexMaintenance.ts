import { db, type MerchantAliasRow, type TagRow } from './db';
import { decryptRows } from './encryptedTable';
import { blindIndex } from '../crypto/cryptoService';
import { getBlindIndexSalt } from './blindIndexSalt';
import type { MerchantAlias, Tag } from '../../domain/entities';

/**
 * Fills in the digests that schema v8 introduced, for rows written before it.
 *
 * This cannot happen inside the Dexie `.upgrade()` hook: computing a digest needs the
 * plaintext, the plaintext lives inside `encryptedData`, and an upgrade runs with no
 * encryption key (it happens on `db.open()`, long before the user unlocks). So the migration
 * is split — the version block reshapes the indexes, and this runs once after the first
 * successful unlock, when a key is finally available.
 *
 * Idempotent and cheap to re-run: it only touches rows whose digest is still missing, so a
 * pass interrupted halfway simply finishes on the next unlock. Until a row is re-indexed its
 * `aliasHash`/`nameHash` is absent, so lookups miss it — the visible effect is a merchant or
 * tag briefly failing to auto-match, never data loss.
 */
export async function runBlindIndexMaintenance(key: CryptoKey): Promise<{ reindexed: number }> {
	const salt = await getBlindIndexSalt();
	let reindexed = 0;

	const staleAliasRows = (await db.merchantAliases.toArray()).filter((row) => !row.aliasHash);
	if (staleAliasRows.length > 0) {
		const aliases = await decryptRows<MerchantAliasRow, MerchantAlias>(key, staleAliasRows);
		const updated = await Promise.all(
			staleAliasRows.map(async (row, i) => ({
				...row,
				aliasHash: await blindIndex(aliases[i].aliasText, salt),
				// Drop the plaintext that used to sit in the index.
				aliasText: undefined
			}))
		);
		await db.merchantAliases.bulkPut(updated);
		reindexed += updated.length;
	}

	const staleTagRows = (await db.tags.toArray()).filter((row) => !row.nameHash);
	if (staleTagRows.length > 0) {
		const tags = await decryptRows<TagRow, Tag>(key, staleTagRows);
		const updated = await Promise.all(
			staleTagRows.map(async (row, i) => ({
				...row,
				nameHash: await blindIndex(tags[i].name, salt),
				name: undefined
			}))
		);
		await db.tags.bulkPut(updated);
		reindexed += updated.length;
	}

	return { reindexed };
}
