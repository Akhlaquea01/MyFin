import { db, type AccountRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import { deletedAtIndex, NOT_DELETED } from './indexable';
import type { Account } from '../../domain/entities';

export type NewAccount = Omit<
	Account,
	'id' | 'currentBalance' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'isArchived'
> & { id?: string };

export const AccountRepository = {
	async create(key: CryptoKey, input: NewAccount): Promise<Account> {
		const now = Date.now();
		const account: Account = {
			id: input.id ?? crypto.randomUUID(),
			name: input.name,
			type: input.type,
			openingBalance: input.openingBalance,
			currentBalance: input.openingBalance,
			creditLimit: input.creditLimit ?? null,
			billingCycleDay: input.billingCycleDay ?? null,
			isArchived: false,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		};
		await putEncrypted(db.accounts, key, account, { deletedAt: NOT_DELETED });
		return account;
	},

	async update(key: CryptoKey, id: string, changes: Partial<Account>): Promise<Account> {
		const existing = await getDecrypted<AccountRow, Account>(db.accounts, key, id);
		if (!existing) throw new Error(`Account ${id} not found`);
		const updated: Account = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.accounts, key, updated, { deletedAt: deletedAtIndex(updated.deletedAt) });
		return updated;
	},

	async setBalance(key: CryptoKey, id: string, currentBalance: number): Promise<void> {
		await this.update(key, id, { currentBalance });
	},

	async softDelete(key: CryptoKey, id: string): Promise<void> {
		if (await this.hasActiveTransactions(id)) {
			throw new Error('Cannot delete an account that still has active transactions.');
		}
		await this.update(key, id, { deletedAt: Date.now() });
	},

	async restore(key: CryptoKey, id: string): Promise<void> {
		await this.update(key, id, { deletedAt: null });
	},

	async getById(key: CryptoKey, id: string): Promise<Account | null> {
		return (await getDecrypted<AccountRow, Account>(db.accounts, key, id)) ?? null;
	},

	async list(key: CryptoKey, includeArchived = true): Promise<Account[]> {
		const rows = await db.accounts.where('deletedAt').equals(NOT_DELETED).toArray();
		const accounts = await decryptRows<AccountRow, Account>(key, rows);
		// IndexedDB ties on the `deletedAt` index fall back to primary-key (UUID) order,
		// not insertion order — sort explicitly so account pickers are stable/predictable.
		accounts.sort((a, b) => a.createdAt - b.createdAt);
		return includeArchived ? accounts : accounts.filter((a) => !a.isArchived);
	},

	async hasActiveTransactions(id: string): Promise<boolean> {
		const count = await db.transactions
			.where('accountId')
			.equals(id)
			.filter((row) => row.deletedAt === NOT_DELETED)
			.count();
		return count > 0;
	}
};
