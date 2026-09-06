import { db, type TransactionRow, type TransactionSplitRow } from './db';
import { encryptRow, getDecrypted, decryptRows } from './encryptedTable';
import { deletedAtIndex, nullableIdIndex, NOT_DELETED } from './indexable';
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
	notes?: string | null;
	source?: TransactionSource;
	reviewStatus?: 'confirmed' | 'unreviewed';
	transferPairId?: string | null;
	duplicateOfId?: string | null;
}

export interface SplitInput {
	categoryId: string;
	amount: number;
}

export interface TransactionFilter {
	accountId?: string;
	categoryId?: string;
	tagId?: string;
	dateFrom?: string;
	dateTo?: string;
	freeText?: string;
	includeDeleted?: boolean;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
				: [{ categoryId: '__uncategorized__', amount: transaction.amount }];
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
			amount: split.amount
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
						amount: split.amount
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
		const outTx = await this.create(
			key,
			{
				id: outId,
				accountId: params.fromAccountId,
				date: params.date,
				amount: -Math.abs(params.amount),
				type: 'transfer',
				transferPairId: inId,
				notes: params.notes ?? null
			},
			[]
		);
		const inTx = await this.create(
			key,
			{
				id: inId,
				accountId: params.toAccountId,
				date: params.date,
				amount: Math.abs(params.amount),
				type: 'transfer',
				transferPairId: outId,
				notes: params.notes ?? null
			},
			[]
		);
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

	async search(key: CryptoKey, filter: TransactionFilter = {}): Promise<Transaction[]> {
		let rows: TransactionRow[];
		if (filter.accountId) {
			rows = await db.transactions.where('accountId').equals(filter.accountId).toArray();
		} else {
			rows = await db.transactions.toArray();
		}
		if (!filter.includeDeleted) rows = rows.filter((r) => r.deletedAt === NOT_DELETED);
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

		if (filter.tagId) {
			const tagRows = await db.transactionTags.where('tagId').equals(filter.tagId).toArray();
			const idsWithTag = new Set(tagRows.map((t) => t.transactionId));
			transactions = transactions.filter((tx) => idsWithTag.has(tx.id));
		}

		if (filter.freeText) {
			const needle = filter.freeText.trim().toLowerCase();
			transactions = transactions.filter((tx) => (tx.notes ?? '').toLowerCase().includes(needle));
		}

		return transactions.sort((a, b) => (a.date < b.date ? 1 : -1));
	}
};
