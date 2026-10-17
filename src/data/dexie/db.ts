import Dexie, { type EntityTable, type Transaction as DexieTransaction } from 'dexie';
import type { EncryptedBlob } from '../crypto/cryptoService';
import type { UserProfile, AutoBackupSettings } from '../../domain/entities';

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

// NOTE: `parentId`/`duplicateOfId`/`transferPairId` below are typed `string`, never `| null` —
// real IndexedDB rejects `null` as an index key or query bound ("Invalid key provided"),
// unlike the fake-indexeddb polyfill Node-side tests run against. Callers must go through
// src/data/dexie/indexable.ts's sentinel mapper ('') rather than storing `null` directly in
// these columns.

export type AccountRow = EncryptedRow;

export interface CategoryRow extends EncryptedRow {
	parentId: string;
}

export type MerchantRow = EncryptedRow;

export interface MerchantAliasRow extends EncryptedRow {
	merchantId: string;
	/**
	 * Salted digest of the lowercased alias text, NOT the text itself — IndexedDB indexes are
	 * stored unencrypted on disk, and this column previously held raw statement descriptions
	 * in the clear. See `blindIndex` in cryptoService.ts. Empty string until the one-time
	 * re-index has run for rows written before schema v8 (see blindIndexMaintenance.ts).
	 */
	aliasHash: string;
	/** @deprecated Plaintext. Blanked by the v8 re-index; kept on the row only so an
	 *  interrupted migration can still be identified and finished. */
	aliasText?: string;
}

export interface TagRow extends EncryptedRow {
	/** Salted digest of the lowercased tag name — see MerchantAliasRow.aliasHash. */
	nameHash: string;
	/** @deprecated Plaintext. Blanked by the v8 re-index. */
	name?: string;
}

export interface TransactionRow extends EncryptedRow {
	accountId: string;
	date: string;
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

export type InvestmentHoldingRow = EncryptedRow;

export interface InvestmentValuationRow extends EncryptedRow {
	holdingId: string;
	date: string;
}

export type LiabilityRow = EncryptedRow;

export interface NetWorthSnapshotRow extends EncryptedRow {
	date: string;
}

export interface BackupRecordRow extends EncryptedRow {
	createdAt: number;
}

// Singleton row ('local-user'); no structural columns beyond `id` are needed.
export type DebtPlannerPreferenceRow = EncryptedRow;

export type SavingsGoalRow = EncryptedRow;

export interface GoalContributionRow extends EncryptedRow {
	goalId: string;
	date: string;
}

// Singleton row ('local-user'); no structural columns beyond `id` are needed.
export type NotificationPreferenceRow = EncryptedRow;

export interface NotifiedItemRow extends EncryptedRow {
	key: string;
}

export interface AttachmentRow extends EncryptedRow {
	transactionId: string;
}

export interface NotificationInboxRow extends EncryptedRow {
	dedupeKey: string;
	createdAt: number;
	/** 0 = unread, 1 = read. A number because a boolean is not a valid IndexedDB key; it lets the
	 *  unread badge be counted without decrypting anything. */
	isRead: number;
}

export interface UnreadableCaptureRow extends EncryptedRow {
	receivedAt: number;
}

export interface CategorizationRuleRow extends EncryptedRow {
	merchantId: string;
}

// Singleton-per-merchant row (id = the merchant's own id); no structural columns beyond
// `id` are needed.
export type MerchantCategorySignalRow = EncryptedRow;

export type PersonRow = EncryptedRow;

export interface PersonLoanRow extends EncryptedRow {
	personId: string;
	accountId: string;
	direction: 'lent' | 'borrowed';
}

export interface PersonLoanRepaymentRow extends EncryptedRow {
	loanId: string;
	accountId: string;
}

export interface SavedFilterViewRow extends EncryptedRow {
	createdAt: number;
}

// Looked up by decrypting the handful of rows (one per bank layout) — no structural column.
export type ImportMappingRow = EncryptedRow;

/**
 * Holds the derived encryption key across a page reload so the app doesn't have to force a
 * fresh PIN/biometric entry on every refresh (spec 009). `key` is stored as a *non-extractable*
 * CryptoKey — IndexedDB's structured-clone support for CryptoKey lets the browser round-trip
 * the key handle without ever exposing raw key bytes to JS, even from this row. `expiresAt`
 * mirrors the in-memory auto-lock deadline; a row past that deadline is treated as absent.
 * Not an EncryptedRow: encrypting a key with itself is meaningless, and non-extractability is
 * what actually protects it, not app-level ciphertext.
 */
export interface SessionKeyRow {
	id: 'local-session';
	key: CryptoKey;
	expiresAt: number;
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
	debtPlannerPreferences!: EntityTable<DebtPlannerPreferenceRow, 'id'>;
	savingsGoals!: EntityTable<SavingsGoalRow, 'id'>;
	goalContributions!: EntityTable<GoalContributionRow, 'id'>;
	notificationPreferences!: EntityTable<NotificationPreferenceRow, 'id'>;
	notifiedItems!: EntityTable<NotifiedItemRow, 'id'>;
	attachments!: EntityTable<AttachmentRow, 'id'>;
	categorizationRules!: EntityTable<CategorizationRuleRow, 'id'>;
	merchantCategorySignals!: EntityTable<MerchantCategorySignalRow, 'id'>;
	people!: EntityTable<PersonRow, 'id'>;
	personLoans!: EntityTable<PersonLoanRow, 'id'>;
	personLoanRepayments!: EntityTable<PersonLoanRepaymentRow, 'id'>;
	savedFilterViews!: EntityTable<SavedFilterViewRow, 'id'>;
	importMappings!: EntityTable<ImportMappingRow, 'id'>;
	notificationInbox!: EntityTable<NotificationInboxRow, 'id'>;
	unreadableCaptures!: EntityTable<UnreadableCaptureRow, 'id'>;
	// Unencrypted by design — see research.md #11 "Exception — UserProfile".
	userProfile!: EntityTable<UserProfile, 'id'>;
	sessionKeys!: EntityTable<SessionKeyRow, 'id'>;
	autoBackupSettings!: EntityTable<AutoBackupSettings, 'id'>;

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
		// v2: adds the debt payoff planner's preference singleton (spec 002). Additive-only
		// per Dexie's versioning model — the v1 block above is never edited retroactively.
		this.version(2).stores({
			debtPlannerPreferences: 'id'
		});
		// v3: adds savings goals and their contributions (spec 003). Additive-only.
		this.version(3).stores({
			savingsGoals: 'id, deletedAt',
			goalContributions: 'id, goalId, date'
		});
		// v4: adds the recurring/budget notification preference singleton and dedupe log
		// (spec 004). Additive-only.
		this.version(4).stores({
			notificationPreferences: 'id',
			notifiedItems: 'id, key'
		});
		// v5: adds receipt/photo attachments on transactions (spec 005). Additive-only.
		this.version(5).stores({
			attachments: 'id, transactionId'
		});
		// v6: adds auto-categorization rules and the per-merchant learning signal (spec 006).
		// Additive-only.
		this.version(6).stores({
			categorizationRules: 'id, merchantId, deletedAt',
			merchantCategorySignals: 'id'
		});
		// v7: adds the cross-reload session key persistence singleton (spec 009). Additive-only.
		this.version(7).stores({
			sessionKeys: 'id'
		});
		// v8: replaces the two plaintext searchable columns (`merchantAliases.aliasText`,
		// `tags.name`) with salted digests, so no user-authored text sits unencrypted in an
		// IndexedDB index (Constitution Principle II).
		//
		// The digest cannot be computed here: a Dexie upgrade runs without the encryption key,
		// and the plaintext lives inside `encryptedData`. So this only reshapes the indexes; the
		// values are filled in by a one-time pass after the next successful unlock — see
		// `runBlindIndexMaintenance` in blindIndexMaintenance.ts.
		this.version(8).stores({
			merchantAliases: 'id, merchantId, aliasHash',
			tags: 'id, nameHash'
		});
		this.version(9).stores({
			people: 'id, deletedAt',
			personLoans: 'id, personId, accountId, direction, deletedAt',
			personLoanRepayments: 'id, loanId, accountId, deletedAt'
		});
		// v10: adds saved filter views for transactions (spec 013). Additive-only.
		this.version(10).stores({
			savedFilterViews: 'id, createdAt'
		});
		// v11: adds soft-delete to budgets (spec 017, FR-013/FR-014) so a removed budget can be
		// undone and stops appearing in current/future tracking, matching every other
		// soft-deletable entity's `deletedAt` index. Unlike v8's aliasHash/nameHash digests,
		// `deletedAt` is never sensitive (a timestamp, not financial content) and needs no
		// encryption key to compute, so the backfill happens directly here rather than deferring
		// to a post-unlock pass (research.md §1).
		this.version(11)
			.stores({
				budgets: 'id, categoryId, deletedAt'
			})
			.upgrade((tx) => tx.table('budgets').toCollection().modify({ deletedAt: 0 }));
		// v12: adds the scheduled local encrypted backup settings singleton (spec 019,
		// FR-026–FR-031). Isolated in its own table rather than folded into `userProfile`
		// because `directoryHandle` is a structured-clone-only browser object, not a plain JSON
		// value like the rest of `userProfile`'s fields (research.md R7).
		this.version(12).stores({
			autoBackupSettings: 'id'
		});
		// v13: remembered import column mappings, one per file layout. Encrypted (header names
		// describe the user's bank) and device-local like the backup settings. Additive-only.
		this.version(13).stores({
			importMappings: 'id'
		});
		// v14: the in-app Alerts list and the captured messages that could not be read. Both are
		// encrypted; both are additive-only.
		this.version(14).stores({
			notificationInbox: 'id, dedupeKey, createdAt, isRead',
			unreadableCaptures: 'id, receivedAt'
		});
		// v15: deletes are permanent, so the `deletedAt` soft-delete column and its indexes go. Rows
		// that were already in Trash are removed here, along with everything that hung off them —
		// otherwise they would sit in the database forever with no screen left to show or purge them.
		// Only plaintext structural columns are used: an upgrade runs without the encryption key.
		this.version(15)
			.stores({
				accounts: 'id',
				categories: 'id, parentId',
				merchants: 'id',
				transactions: 'id, accountId, date, reviewStatus, duplicateOfId, transferPairId',
				budgets: 'id, categoryId',
				investmentHoldings: 'id',
				liabilities: 'id',
				savingsGoals: 'id',
				categorizationRules: 'id, merchantId',
				people: 'id',
				personLoans: 'id, personId, accountId, direction',
				personLoanRepayments: 'id, loanId, accountId'
			})
			.upgrade(purgeTrashedRows);
	}
}

/** Ids of rows in Trash as v1–v14 stored it: `deletedAt` 0 = live, a timestamp = trashed. */
function trashedIds(tx: DexieTransaction, table: string): Promise<string[]> {
	return tx
		.table<{ id: string; deletedAt?: number }, string>(table)
		.filter((row) => typeof row.deletedAt === 'number' && row.deletedAt !== 0)
		.primaryKeys();
}

async function purgeTrashedRows(tx: DexieTransaction): Promise<void> {
	const removeChildren = async (child: string, index: string, parentIds: string[]) => {
		if (parentIds.length > 0) await tx.table(child).where(index).anyOf(parentIds).delete();
	};

	const transactionIds = await trashedIds(tx, 'transactions');
	await removeChildren('transactionSplits', 'transactionId', transactionIds);
	await removeChildren('transactionTags', 'transactionId', transactionIds);
	await removeChildren('attachments', 'transactionId', transactionIds);
	await tx.table('transactions').bulkDelete(transactionIds);

	const holdingIds = await trashedIds(tx, 'investmentHoldings');
	await removeChildren('investmentValuations', 'holdingId', holdingIds);
	await tx.table('investmentHoldings').bulkDelete(holdingIds);

	const goalIds = await trashedIds(tx, 'savingsGoals');
	await removeChildren('goalContributions', 'goalId', goalIds);
	await tx.table('savingsGoals').bulkDelete(goalIds);

	const budgetIds = await trashedIds(tx, 'budgets');
	await removeChildren('budgetItems', 'budgetId', budgetIds);
	await tx.table('budgets').bulkDelete(budgetIds);

	// A person's loans and repayments go with them (a person can only be deleted once nothing is
	// owed), as do a trashed loan's repayments.
	const personIds = await trashedIds(tx, 'people');
	const loansOfPeople = personIds.length
		? await tx.table('personLoans').where('personId').anyOf(personIds).primaryKeys()
		: [];
	const loanIds = [...new Set([...(await trashedIds(tx, 'personLoans')), ...loansOfPeople])];
	await removeChildren('personLoanRepayments', 'loanId', loanIds);
	await tx.table('personLoanRepayments').bulkDelete(await trashedIds(tx, 'personLoanRepayments'));
	await tx.table('personLoans').bulkDelete(loanIds);
	await tx.table('people').bulkDelete(personIds);

	for (const table of [
		'accounts',
		'categories',
		'merchants',
		'liabilities',
		'categorizationRules'
	]) {
		await tx.table(table).bulkDelete(await trashedIds(tx, table));
	}
}

export const db = new MyFinDatabase();
