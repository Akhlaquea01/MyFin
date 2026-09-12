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

// Singleton row ('local-user'); no structural columns beyond `id` are needed.
export type DebtPlannerPreferenceRow = EncryptedRow;

export interface SavingsGoalRow extends EncryptedRow {
	deletedAt: number;
}

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

export interface CategorizationRuleRow extends EncryptedRow {
	merchantId: string;
	deletedAt: number;
}

// Singleton-per-merchant row (id = the merchant's own id); no structural columns beyond
// `id` are needed.
export type MerchantCategorySignalRow = EncryptedRow;

export interface PersonRow extends EncryptedRow {
	deletedAt: number;
}

export interface PersonLoanRow extends EncryptedRow {
	personId: string;
	accountId: string;
	direction: 'lent' | 'borrowed';
	deletedAt: number;
}

export interface PersonLoanRepaymentRow extends EncryptedRow {
	loanId: string;
	accountId: string;
	deletedAt: number;
}

export interface SavedFilterViewRow extends EncryptedRow {
	createdAt: number;
}


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
	// Unencrypted by design — see research.md #11 "Exception — UserProfile".
	userProfile!: EntityTable<UserProfile, 'id'>;
	sessionKeys!: EntityTable<SessionKeyRow, 'id'>;

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
	}
}


export const db = new MyFinDatabase();
