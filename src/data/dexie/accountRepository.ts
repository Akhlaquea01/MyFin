import { db, type AccountRow } from './db';
import { putEncrypted, getDecrypted, decryptRows } from './encryptedTable';
import type { Account } from '../../domain/entities';

export type NewAccount = Omit<
	Account,
	'id' | 'currentBalance' | 'createdAt' | 'updatedAt' | 'isArchived'
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
			cardLast4: input.cardLast4 ?? null,
			cardNickname: input.cardNickname ?? null,
			accountLast4: input.accountLast4 ?? null,
			// Written only when set, so an account without a custom threshold keeps the shape it always had.
			...(input.lowBalanceThresholdMinor !== undefined
				? { lowBalanceThresholdMinor: input.lowBalanceThresholdMinor }
				: {}),
			isArchived: false,
			createdAt: now,
			updatedAt: now
		};
		await putEncrypted(db.accounts, key, account, {});
		return account;
	},

	async update(key: CryptoKey, id: string, changes: Partial<Account>): Promise<Account> {
		const existing = await getDecrypted<AccountRow, Account>(db.accounts, key, id);
		if (!existing) throw new Error(`Account ${id} not found`);
		const updated: Account = { ...existing, ...changes, id, updatedAt: Date.now() };
		await putEncrypted(db.accounts, key, updated, {});
		return updated;
	},

	async setBalance(key: CryptoKey, id: string, currentBalance: number): Promise<void> {
		await this.update(key, id, { currentBalance });
	},

	async remove(id: string): Promise<void> {
		if (await this.hasTransactions(id)) {
			throw new Error('Cannot delete an account that still has transactions.');
		}
		// A recurring payment names the account it is paid from; deleting the account would leave the
		// rule pointing at nothing (shown as a raw id, and still raising reminders).
		if ((await db.recurringRules.where('accountId').equals(id).count()) > 0) {
			throw new Error('Cannot delete an account that still has recurring payments.');
		}
		await db.accounts.delete(id);
	},

	async getById(key: CryptoKey, id: string): Promise<Account | null> {
		return (await getDecrypted<AccountRow, Account>(db.accounts, key, id)) ?? null;
	},

	async list(key: CryptoKey, includeArchived = true): Promise<Account[]> {
		const rows = await db.accounts.toArray();
		const accounts = await decryptRows<AccountRow, Account>(key, rows);
		// Sort explicitly: rows come back in primary-key (UUID) order, not insertion order, so
		// account pickers would otherwise be unstable/unpredictable.
		accounts.sort((a, b) => a.createdAt - b.createdAt);
		return includeArchived ? accounts : accounts.filter((a) => !a.isArchived);
	},

	async hasTransactions(id: string): Promise<boolean> {
		return (await db.transactions.where('accountId').equals(id).count()) > 0;
	}
};
