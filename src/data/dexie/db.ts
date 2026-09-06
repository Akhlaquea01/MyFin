import Dexie, { type EntityTable } from 'dexie';
import type { EncryptedBlob } from '../crypto/cryptoService';
import type { UserProfile } from '../../domain/entities';

/**
 * Every table except `userProfile` stores a row shaped as its non-sensitive structural
 * (indexed) columns plus one `encryptedData` blob holding the AES-GCM ciphertext of the
 * *entire* plaintext entity. See research.md #11 for why: amounts, notes, and names never
 * touch disk unencrypted, while foreign keys/dates/status enums stay indexed for
 * FR-013/SC-008-class query performance.
 */
export interface EncryptedRow {
	id: string;
	encryptedData: EncryptedBlob;
}

// NOTE: `deletedAt`/`parentId`/`duplicateOfId`/`transferPairId` below are typed `number`/
// `string`, never `| null` — real IndexedDB rejects `null` as an index key or query bound
// ("Invalid key provided"), unlike the fake-indexeddb polyfill Node-side tests run
// against. Callers must go through src/data/dexie/indexable.ts's sentinel mappers
// (0 / '') rather than storing `null` directly in these columns.

export interface AccountRow extends EncryptedRow {
	deletedAt: number;
}

export interface CategoryRow extends EncryptedRow {
	parentId: string;
	deletedAt: number;
}

export interface MerchantRow extends EncryptedRow {
	deletedAt: number;
}

export interface MerchantAliasRow extends EncryptedRow {
	merchantId: string;
	aliasText: string;
}

export interface TagRow extends EncryptedRow {
	name: string;
}

export interface TransactionRow extends EncryptedRow {
	accountId: string;
	date: string;
	deletedAt: number;
	reviewStatus: 'confirmed' | 'unreviewed';
	duplicateOfId: string;
	transferPairId: string;
}

export interface TransactionSplitRow extends EncryptedRow {
	transactionId: string;
	categoryId: string;
}

export interface TransactionTagRow {
	// Pure join table of opaque UUIDs — no sensitive content to encrypt.
	id: string;
	transactionId: string;
	tagId: string;
}

export interface BudgetRow extends EncryptedRow {
	categoryId: string;
}

export interface BudgetItemRow extends EncryptedRow {
	budgetId: string;
	periodStart: string;
	periodEnd: string;
}

export interface RecurringRuleRow extends EncryptedRow {
	accountId: string;
	categoryId: string;
	isActive: number; // Dexie can't index booleans; 0/1
}

export interface ExpectedEventRow extends EncryptedRow {
	recurringRuleId: string;
	expectedDate: string;
	status: 'pending' | 'matched' | 'missed';
}

export interface InvestmentHoldingRow extends EncryptedRow {
	deletedAt: number;
}

export interface InvestmentValuationRow extends EncryptedRow {
	holdingId: string;
	date: string;
}

export interface LiabilityRow extends EncryptedRow {
	deletedAt: number;
}

export interface NetWorthSnapshotRow extends EncryptedRow {
	date: string;
}

export interface BackupRecordRow extends EncryptedRow {
	createdAt: number;
}

class MyFinDatabase extends Dexie {
	accounts!: EntityTable<AccountRow, 'id'>;
	categories!: EntityTable<CategoryRow, 'id'>;
	merchants!: EntityTable<MerchantRow, 'id'>;
	merchantAliases!: EntityTable<MerchantAliasRow, 'id'>;
	tags!: EntityTable<TagRow, 'id'>;
	transactions!: EntityTable<TransactionRow, 'id'>;
	transactionSplits!: EntityTable<TransactionSplitRow, 'id'>;
	transactionTags!: EntityTable<TransactionTagRow, 'id'>;
	budgets!: EntityTable<BudgetRow, 'id'>;
	budgetItems!: EntityTable<BudgetItemRow, 'id'>;
	recurringRules!: EntityTable<RecurringRuleRow, 'id'>;
	expectedEvents!: EntityTable<ExpectedEventRow, 'id'>;
	investmentHoldings!: EntityTable<InvestmentHoldingRow, 'id'>;
	investmentValuations!: EntityTable<InvestmentValuationRow, 'id'>;
	liabilities!: EntityTable<LiabilityRow, 'id'>;
	netWorthSnapshots!: EntityTable<NetWorthSnapshotRow, 'id'>;
	backupRecords!: EntityTable<BackupRecordRow, 'id'>;
	// Unencrypted by design — see research.md #11 "Exception — UserProfile".
	userProfile!: EntityTable<UserProfile, 'id'>;

	constructor() {
		super('myfin');
		this.version(1).stores({
			accounts: 'id, deletedAt',
			categories: 'id, parentId, deletedAt',
			merchants: 'id, deletedAt',
			merchantAliases: 'id, merchantId, aliasText',
			tags: 'id, name',
			transactions: 'id, accountId, date, deletedAt, reviewStatus, duplicateOfId, transferPairId',
			transactionSplits: 'id, transactionId, categoryId',
			transactionTags: 'id, transactionId, tagId',
			budgets: 'id, categoryId',
			budgetItems: 'id, budgetId, periodStart, periodEnd',
			recurringRules: 'id, accountId, categoryId, isActive',
			expectedEvents: 'id, recurringRuleId, expectedDate, status',
			investmentHoldings: 'id, deletedAt',
			investmentValuations: 'id, holdingId, date',
			liabilities: 'id, deletedAt',
			netWorthSnapshots: 'id, date',
			backupRecords: 'id, createdAt',
			userProfile: 'id'
		});
	}
}

export const db = new MyFinDatabase();
