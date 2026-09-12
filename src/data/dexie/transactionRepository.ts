import { db, type TransactionRow, type TransactionSplitRow } from './db';
import { encryptRow, getDecrypted, decryptRows } from './encryptedTable';
import { deletedAtIndex, nullableIdIndex, NOT_DELETED } from './indexable';
import { AttachmentRepository } from './attachmentRepository';
import { TagRepository } from './tagRepository';
import { normalizeTagText, transactionMatchesFreeText } from '../../domain/transactions/tagFilterEngine';
import type {
	Transaction,
	TransactionSplit,
	TransactionType,
	TransactionSource
} from '../../domain/entities';

export interface NewTransactionInput {
	id?: string;
	accountId: string;
	date: string;
	amount: number;
	type: TransactionType;
	merchantId?: string | null;
	/** The specific MerchantAlias that resolved to `merchantId` (spec 006) — read only by
	 *  `TransactionEngine.recordTransaction` to support alias-scoped categorization rules;
	 *  `TransactionRepository.create` itself never persists it. */
	merchantAliasId?: string | null;
	notes?: string | null;
	source?: TransactionSource;
	reviewStatus?: 'confirmed' | 'unreviewed';
	transferPairId?: string | null;
	duplicateOfId?: string | null;
}

export interface SplitInput {
	categoryId: string;
	amount: number;
	categorizationSource?: 'rule' | 'suggestion';
}

/** The sentinel category assigned when a transaction is saved with no split at all — see
 *  `create()` below. Exported so callers (e.g. the Review Queue) can render/round-trip the
 *  same "Uncategorized" placeholder rather than duplicating the magic string. */
export const UNCATEGORIZED_CATEGORY_ID = '__uncategorized__';

export interface TransactionFilter {
	accountId?: string;
	categoryId?: string;
	/** Matches a transaction carrying *any* of these tag ids (OR) — spec 012, FR-002. */
	tagIds?: string[];
	dateFrom?: string;
	dateTo?: string;
	freeText?: string;
	includeDeleted?: boolean;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Open bounds for an index range query. IndexedDB requires concrete keys, and every stored
// date is a "YYYY-MM-DD" string, so these sort correctly as string bounds.
const MIN_DATE = '0000-01-01';
const MAX_DATE = '9999-12-31';

/**
 * Newest first, with deterministic tie-breaking. The previous comparator
 * (`a.date < b.date ? 1 : -1`) never returned 0, so for two rows sharing a date it asserted
 * both orderings at once — an invalid comparator, which let the sort arrange same-day
 * transactions differently between loads. Same-day is the common case.
 */
function sortNewestFirst(transactions: Transaction[]): Transaction[] {
	return transactions.sort(
		(a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt || a.id.localeCompare(b.id)
	);
}

function toRow(tx: Transaction): Omit<TransactionRow, 'id' | 'encryptedData'> {
	return {
		accountId: tx.accountId,
		date: tx.date,
		deletedAt: deletedAtIndex(tx.deletedAt),
		reviewStatus: tx.reviewStatus,
		duplicateOfId: nullableIdIndex(tx.duplicateOfId),
		transferPairId: nullableIdIndex(tx.transferPairId)
	};
}

export const TransactionRepository = {
	async create(
		key: CryptoKey,
		input: NewTransactionInput,
		splits: SplitInput[]
	): Promise<Transaction> {
		const now = Date.now();
		const transaction: Transaction = {
			id: input.id ?? crypto.randomUUID(),
			accountId: input.accountId,
			date: input.date,
			amount: input.amount,
			type: input.type,
			transferPairId: input.transferPairId ?? null,
			merchantId: input.merchantId ?? null,
			notes: input.notes ?? null,
			source: input.source ?? 'manual',
			reviewStatus: input.reviewStatus ?? 'confirmed',
			duplicateOfId: input.duplicateOfId ?? null,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};

		const resolvedSplits: SplitInput[] =
			splits.length > 0
				? splits
				: [{ categoryId: UNCATEGORIZED_CATEGORY_ID, amount: transaction.amount }];
		const splitSum = resolvedSplits.reduce((sum, s) => sum + s.amount, 0);
		if (splitSum !== transaction.amount) {
			throw new Error(
				`Split amounts (${splitSum}) must sum to the transaction amount (${transaction.amount}).`
			);
		}

		// Encrypt everything up front — a `db.transaction(...)` block loses its tracked
		// scope across an awaited non-Dexie promise (see encryptedTable.ts), so the actual
		// `.put()` calls below must be the only awaits inside it.
		const transactionRow = await encryptRow<TransactionRow, Transaction>(
			key,
			transaction,
			toRow(transaction)
		);
		const splitEntities: TransactionSplit[] = resolvedSplits.map((split) => ({
			id: crypto.randomUUID(),
			transactionId: transaction.id,
			categoryId: split.categoryId,
			amount: split.amount,
			categorizationSource: split.categorizationSource
		}));
		const splitRows = await Promise.all(
			splitEntities.map((splitEntity) =>
				encryptRow<TransactionSplitRow, TransactionSplit>(key, splitEntity, {
					transactionId: splitEntity.transactionId,
					categoryId: splitEntity.categoryId
				})
			)
		);

		await db.transaction('rw', db.transactions, db.transactionSplits, async () => {
			await db.transactions.put(transactionRow);
			for (const row of splitRows) {
				await db.transactionSplits.put(row);
			}
		});

		return transaction;
	},

	async update(
		key: CryptoKey,
		id: string,
		changes: Partial<Transaction>,
		splits?: SplitInput[]
	): Promise<Transaction> {
		const existing = await getDecrypted<TransactionRow, Transaction>(db.transactions, key, id);
		if (!existing) throw new Error(`Transaction ${id} not found`);
		const updated: Transaction = { ...existing, ...changes, id, updatedAt: Date.now() };

		if (splits) {
			const splitSum = splits.reduce((sum, s) => sum + s.amount, 0);
			if (splitSum !== updated.amount) {
				throw new Error(
					`Split amounts (${splitSum}) must sum to the transaction amount (${updated.amount}).`
				);
			}
		} else if (changes.amount !== undefined && changes.amount !== existing.amount) {
			// Changing the amount without supplying splits previously left the old splits in
			// place, so the ledger total and the category breakdown disagreed permanently, with
			// nothing flagging it.
			const current = await this.getSplits(key, id);
			const currentSum = current.reduce((sum, s) => sum + s.amount, 0);
			if (currentSum !== updated.amount) {
				throw new Error(
					`Changing the amount to ${updated.amount} requires new splits ` +
						`(existing splits sum to ${currentSum}).`
				);
			}
		}

		const transactionRow = await encryptRow<TransactionRow, Transaction>(
			key,
			updated,
			toRow(updated)
		);
		let splitRows: TransactionSplitRow[] = [];
		if (splits) {
			splitRows = await Promise.all(
				splits.map((split) => {
					const splitEntity: TransactionSplit = {
						id: crypto.randomUUID(),
						transactionId: id,
						categoryId: split.categoryId,
						amount: split.amount,
						categorizationSource: split.categorizationSource
					};
					return encryptRow<TransactionSplitRow, TransactionSplit>(key, splitEntity, {
						transactionId: id,
						categoryId: split.categoryId
					});
				})
			);
		}

		await db.transaction('rw', db.transactions, db.transactionSplits, async () => {
			await db.transactions.put(transactionRow);
			if (splits) {
				await db.transactionSplits.where('transactionId').equals(id).delete();
				for (const row of splitRows) {
					await db.transactionSplits.put(row);
				}
			}
		});

		return updated;
	},

	async softDelete(key: CryptoKey, id: string): Promise<void> {
		await this.update(key, id, { deletedAt: Date.now() });
	},

	async restore(key: CryptoKey, id: string): Promise<void> {
		await this.update(key, id, { deletedAt: null });
	},

	/**
	 * Permanently deletes a transaction and everything scoped to it (splits, tags,
	 * attachments) in one Dexie transaction — the first permanent-purge flow in this
	 * codebase (research.md §5, spec 005), deliberately restricted to Transactions. Only
	 * callable from Trash: throws if the transaction is not already soft-deleted, matching
	 * Constitution Principle VI's "permanent purge requires explicit, separate user
	 * confirmation" (the UI only ever offers this action from within Trash).
	 */
	async purge(key: CryptoKey, id: string): Promise<void> {
		const existing = await getDecrypted<TransactionRow, Transaction>(db.transactions, key, id);
		if (!existing) throw new Error(`Transaction ${id} not found`);
		if (existing.deletedAt === null) {
			throw new Error('Only a soft-deleted transaction can be permanently purged.');
		}

		await db.transaction(
			'rw',
			[db.transactions, db.transactionSplits, db.transactionTags, db.attachments],
			async () => {
				await db.transactions.delete(id);
				await db.transactionSplits.where('transactionId').equals(id).delete();
				await db.transactionTags.where('transactionId').equals(id).delete();
				await AttachmentRepository.purgeForTransaction(key, id);
			}
		);
	},

	async getById(key: CryptoKey, id: string): Promise<Transaction | null> {
		return (await getDecrypted<TransactionRow, Transaction>(db.transactions, key, id)) ?? null;
	},

	async getSplits(key: CryptoKey, transactionId: string): Promise<TransactionSplit[]> {
		const rows = await db.transactionSplits.where('transactionId').equals(transactionId).toArray();
		return decryptRows<TransactionSplitRow, TransactionSplit>(key, rows);
	},

	/**
	 * Creates a linked pair of transactions representing a transfer between two of the
	 * user's own accounts (FR-011): a negative leg on the source account and a positive
	 * leg on the destination account, cross-referenced via `transferPairId`.
	 */
	async createTransferPair(
		key: CryptoKey,
		params: {
			fromAccountId: string;
			toAccountId: string;
			amount: number;
			date: string;
			notes?: string;
		}
	): Promise<[Transaction, Transaction]> {
		const outId = crypto.randomUUID();
		const inId = crypto.randomUUID();
		const now = Date.now();

		const leg = (id: string, pairId: string, accountId: string, amount: number): Transaction => ({
			id,
			accountId,
			date: params.date,
			amount,
			type: 'transfer',
			transferPairId: pairId,
			merchantId: null,
			notes: params.notes ?? null,
			source: 'manual',
			reviewStatus: 'confirmed',
			duplicateOfId: null,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		});

		const outTx = leg(outId, inId, params.fromAccountId, -Math.abs(params.amount));
		const inTx = leg(inId, outId, params.toAccountId, Math.abs(params.amount));

		// Both legs commit together or neither does. Previously these were two independent
		// `create()` calls, each opening its own Dexie transaction: a failure between them left
		// money debited from one account and arriving nowhere, with a `transferPairId` pointing
		// at a row that never existed. All encryption happens first, because a `db.transaction`
		// block loses its tracked scope across an awaited non-Dexie promise (encryptedTable.ts).
		const [outRow, inRow] = await Promise.all([
			encryptRow<TransactionRow, Transaction>(key, outTx, toRow(outTx)),
			encryptRow<TransactionRow, Transaction>(key, inTx, toRow(inTx))
		]);
		const splitEntities: TransactionSplit[] = [outTx, inTx].map((tx) => ({
			id: crypto.randomUUID(),
			transactionId: tx.id,
			categoryId: UNCATEGORIZED_CATEGORY_ID,
			amount: tx.amount
		}));
		const splitRows = await Promise.all(
			splitEntities.map((splitEntity) =>
				encryptRow<TransactionSplitRow, TransactionSplit>(key, splitEntity, {
					transactionId: splitEntity.transactionId,
					categoryId: splitEntity.categoryId
				})
			)
		);

		await db.transaction('rw', db.transactions, db.transactionSplits, async () => {
			await db.transactions.bulkPut([outRow, inRow]);
			await db.transactionSplits.bulkPut(splitRows);
		});

		return [outTx, inTx];
	},

	/**
	 * FR-020/FR-038 duplicate rule: same account, same amount, date within ±1 day.
	 * Narrows via the indexed accountId+date columns before decrypting the (small)
	 * candidate set — never a full-table scan (research.md #11).
	 */
	async findPossibleDuplicates(
		key: CryptoKey,
		accountId: string,
		amount: number,
		date: string
	): Promise<Transaction[]> {
		const target = new Date(date).getTime();
		const from = new Date(target - ONE_DAY_MS).toISOString().slice(0, 10);
		const to = new Date(target + ONE_DAY_MS).toISOString().slice(0, 10);
		const rows = await db.transactions
			.where('accountId')
			.equals(accountId)
			.filter((row) => row.deletedAt === NOT_DELETED && row.date >= from && row.date <= to)
			.toArray();
		const candidates = await decryptRows<TransactionRow, Transaction>(key, rows);
		return candidates.filter((tx) => tx.amount === amount);
	},

	async listUnreviewed(key: CryptoKey): Promise<Transaction[]> {
		const rows = await db.transactions
			.where('reviewStatus')
			.equals('unreviewed')
			.filter((row) => row.deletedAt === NOT_DELETED)
			.toArray();
		return decryptRows<TransactionRow, Transaction>(key, rows);
	},

	/**
	 * Narrows on the indexed structural columns *before* decrypting anything — decryption is by
	 * far the dominant cost here, so every row an index excludes is a row never decrypted. A
	 * date range now uses the `date` index instead of a linear scan over the whole table.
	 */
	async search(key: CryptoKey, filter: TransactionFilter = {}): Promise<Transaction[]> {
		let collection;
		if (filter.accountId) {
			collection = db.transactions.where('accountId').equals(filter.accountId);
		} else if (filter.dateFrom || filter.dateTo) {
			collection = db.transactions
				.where('date')
				.between(filter.dateFrom ?? MIN_DATE, filter.dateTo ?? MAX_DATE, true, true);
		} else {
			collection = db.transactions.toCollection();
		}
		let rows = await collection.toArray();

		if (!filter.includeDeleted) rows = rows.filter((r) => r.deletedAt === NOT_DELETED);
		// Applied unconditionally: when `accountId` selected the index above, the date bounds
		// have not been applied yet.
		if (filter.dateFrom) rows = rows.filter((r) => r.date >= filter.dateFrom!);
		if (filter.dateTo) rows = rows.filter((r) => r.date <= filter.dateTo!);

		let transactions = await decryptRows<TransactionRow, Transaction>(key, rows);

		if (filter.categoryId) {
			const splitRows = await db.transactionSplits
				.where('categoryId')
				.equals(filter.categoryId)
				.toArray();
			const idsWithCategory = new Set(splitRows.map((s) => s.transactionId));
			transactions = transactions.filter((tx) => idsWithCategory.has(tx.id));
		}

		if (filter.tagIds && filter.tagIds.length > 0) {
			const tagRows = await db.transactionTags.where('tagId').anyOf(filter.tagIds).toArray();
			const idsWithAnyTag = new Set(tagRows.map((t) => t.transactionId));
			transactions = transactions.filter((tx) => idsWithAnyTag.has(tx.id));
		}

		if (filter.freeText) {
			const needle = normalizeTagText(filter.freeText);
			const candidateIds = transactions.map((tx) => tx.id);
			const tagRows = await db.transactionTags.where('transactionId').anyOf(candidateIds).toArray();
			const tagNameById = new Map((await TagRepository.list(key)).map((t) => [t.id, t.name]));
			const tagNamesByTx = new Map<string, string[]>();
			for (const row of tagRows) {
				const name = tagNameById.get(row.tagId);
				if (!name) continue;
				const names = tagNamesByTx.get(row.transactionId) ?? [];
				names.push(name);
				tagNamesByTx.set(row.transactionId, names);
			}
			transactions = transactions.filter((tx) =>
				transactionMatchesFreeText(tx.notes, tagNamesByTx.get(tx.id) ?? [], needle)
			);
		}

		return sortNewestFirst(transactions);
	},

	/** Counts live transactions off the index — no rows decrypted. */
	async countActive(): Promise<number> {
		return db.transactions.where('deletedAt').equals(NOT_DELETED).count();
	},

	/** Counts unreviewed transactions straight off the index — no rows decrypted. */
	async countUnreviewed(): Promise<number> {
		return db.transactions
			.where('reviewStatus')
			.equals('unreviewed')
			.filter((row) => row.deletedAt === NOT_DELETED)
			.count();
	},

	/**
	 * The most recent `limit` transactions, newest first. Walks the `date` index backwards and
	 * decrypts only what it takes — the dashboard needs a handful of rows plus a short trend,
	 * and previously paid for decrypting the entire ledger to get them.
	 */
	async listRecent(key: CryptoKey, limit: number): Promise<Transaction[]> {
		if (limit <= 0) return [];
		const rows: TransactionRow[] = [];
		await db.transactions
			.orderBy('date')
			.reverse()
			.until(() => rows.length >= limit)
			.each((row) => {
				if (row.deletedAt === NOT_DELETED) rows.push(row);
			});
		const transactions = await decryptRows<TransactionRow, Transaction>(key, rows.slice(0, limit));
		return sortNewestFirst(transactions);
	},

	/**
	 * All splits for many transactions in one query, grouped by transaction id. Replaces
	 * per-transaction `getSplits` calls inside loops (export, analytics), each of which cost an
	 * indexed query plus a decrypt batch of its own.
	 */
	async splitsByTransaction(
		key: CryptoKey,
		transactionIds?: string[]
	): Promise<Map<string, TransactionSplit[]>> {
		const rows =
			transactionIds === undefined
				? await db.transactionSplits.toArray()
				: await db.transactionSplits.where('transactionId').anyOf(transactionIds).toArray();
		const splits = await decryptRows<TransactionSplitRow, TransactionSplit>(key, rows);
		const grouped = new Map<string, TransactionSplit[]>();
		for (const split of splits) {
			const existing = grouped.get(split.transactionId);
			if (existing) existing.push(split);
			else grouped.set(split.transactionId, [split]);
		}
		return grouped;
	}
};
