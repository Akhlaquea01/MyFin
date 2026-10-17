// A raw copy of the data tables, so a long multi-step write that cannot run as one Dexie transaction
// (every step encrypts first, and a transaction block loses its tracked scope across an awaited Web
// Crypto call — see encryptedTable.ts) can still be all-or-nothing: if it fails part-way, the tables
// go back to exactly what they held.
//
// The copy is of the stored rows, still encrypted — nothing is decrypted or re-encrypted, so putting
// them back is a plain write that CAN run inside one transaction, and cannot fail on a key problem.
//
// Left alone, because a data write never touches them: the profile, the resumable session key, and
// this device's backup/import settings. Attachments are copied by id only: they are large, and the one
// writer that needs rollback (the data-template import) only ever adds them.
import { db } from './db';

const NOT_DATA = new Set(['userProfile', 'sessionKeys', 'autoBackupSettings', 'backupRecords']);
const IDS_ONLY = new Set(['attachments']);
const DEVICE_LOCAL = new Set(['importMappings']);

const dataTables = () =>
	db.tables.filter((table) => !NOT_DATA.has(table.name) && !DEVICE_LOCAL.has(table.name));

export interface DatabaseSnapshot {
	rows: Map<string, unknown[]>;
	/** Ids that existed in each id-only table. */
	ids: Map<string, Set<string>>;
}

export async function snapshotDatabase(): Promise<DatabaseSnapshot> {
	const rows = new Map<string, unknown[]>();
	const ids = new Map<string, Set<string>>();
	for (const table of dataTables()) {
		if (IDS_ONLY.has(table.name)) {
			ids.set(table.name, new Set((await table.toCollection().primaryKeys()).map(String)));
		} else {
			rows.set(table.name, await table.toArray());
		}
	}
	return { rows, ids };
}

/** Puts every data table back to the snapshot, in one transaction: all of it, or none. */
export async function restoreSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
	const tables = dataTables();
	await db.transaction('rw', tables, async () => {
		for (const table of tables) {
			const keep = snapshot.ids.get(table.name);
			if (keep) {
				const extra = (await table.toCollection().primaryKeys()).filter(
					(id) => !keep.has(String(id))
				);
				await table.bulkDelete(extra);
				continue;
			}
			await table.clear();
			await table.bulkPut(snapshot.rows.get(table.name) ?? []);
		}
	});
}
