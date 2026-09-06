import type { EntityTable } from 'dexie';
import { encrypt, decrypt } from '../crypto/cryptoService';
import type { EncryptedRow } from './db';

/**
 * Encrypts `entity` into a row shape, merging in the given plaintext structural (indexed)
 * columns. The full plaintext `entity` — including the values duplicated into structural
 * columns — is what gets encrypted, so a decrypted row is always self-describing on its
 * own (see research.md #11).
 *
 * Deliberately does NOT write to the table itself: Dexie tracks a `db.transaction(...)`
 * block via its execution zone, and awaiting a non-Dexie promise (Web Crypto's
 * `encrypt()`) partway through breaks that tracking, causing a `PrematureCommitError` on
 * any `table.put()` called afterward in the same block. Callers that need atomicity
 * across multiple tables must encrypt every row first (outside the transaction), then
 * open `db.transaction(...)` and call `.put()` on the pre-built rows only.
 */
export async function encryptRow<Row extends EncryptedRow, Entity extends { id: string }>(
	key: CryptoKey,
	entity: Entity,
	structuralFields: Omit<Row, 'id' | 'encryptedData'>
): Promise<Row> {
	const encryptedData = await encrypt(key, entity);
	return { id: entity.id, encryptedData, ...structuralFields } as unknown as Row;
}

/** Convenience wrapper for a single write with no surrounding multi-table transaction. */
export async function putEncrypted<Row extends EncryptedRow, Entity extends { id: string }>(
	table: EntityTable<Row, 'id'>,
	key: CryptoKey,
	entity: Entity,
	structuralFields: Omit<Row, 'id' | 'encryptedData'>
): Promise<void> {
	const row = await encryptRow<Row, Entity>(key, entity, structuralFields);
	await table.put(row);
}

export async function getDecrypted<Row extends EncryptedRow, Entity>(
	table: EntityTable<Row, 'id'>,
	key: CryptoKey,
	id: string
): Promise<Entity | undefined> {
	// Dexie's `IDType<Row, 'id'>` can't be resolved while `Row` is still an open generic
	// parameter here; the runtime behavior is a plain string primary-key lookup regardless.
	const row = await table.get(id as never);
	if (!row) return undefined;
	return decrypt<Entity>(key, row.encryptedData);
}

export async function decryptRows<Row extends EncryptedRow, Entity>(
	key: CryptoKey,
	rows: Row[]
): Promise<Entity[]> {
	return Promise.all(rows.map((row) => decrypt<Entity>(key, row.encryptedData)));
}
