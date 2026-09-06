import { db } from '../dexie/db';
import { encryptRow, decryptRows, getDecrypted } from '../dexie/encryptedTable';
import { deletedAtIndex, nullableIdIndex } from '../dexie/indexable';
import { encrypt, decrypt, sha256Hex, deriveEncryptionKey } from '../crypto/cryptoService';
import { migrateFromV1 } from './migrations/v1';
import { migrateFromV1_1 } from './migrations/v1_1';
import { migrateFromV1_2 } from './migrations/v1_2';
import { migrateFromV1_3 } from './migrations/v1_3';
import type {
	AccountRow,
	CategoryRow,
	MerchantRow,
	MerchantAliasRow,
	TagRow,
	TransactionRow,
	TransactionSplitRow,
	TransactionTagRow,
	BudgetRow,
	BudgetItemRow,
	RecurringRuleRow,
	ExpectedEventRow,
	InvestmentHoldingRow,
	InvestmentValuationRow,
	LiabilityRow,
	NetWorthSnapshotRow,
	DebtPlannerPreferenceRow,
	SavingsGoalRow,
	GoalContributionRow,
	NotificationPreferenceRow,
	NotifiedItemRow,
	AttachmentRow,
	CategorizationRuleRow,
	MerchantCategorySignalRow
} from '../dexie/db';
import type {
	Account,
	Category,
	Merchant,
	MerchantAlias,
	Tag,
	Transaction,
	TransactionSplit,
	Budget,
	BudgetItem,
	RecurringRule,
	ExpectedEvent,
	InvestmentHolding,
	InvestmentValuation,
	Liability,
	NetWorthSnapshot,
	UserProfile,
	DebtPlannerPreference,
	SavingsGoal,
	GoalContribution,
	NotificationPreference,
	NotifiedItem,
	Attachment,
	CategorizationRule,
	MerchantCategorySignal
} from '../../domain/entities';

const CONTAINER = 'personal-finance-manager-backup';
const CONTAINER_VERSION = 1;
export const CURRENT_SCHEMA_VERSION = '1.3.0';
const PREFERENCE_ID = 'local-user';

/** A join-table row kept verbatim (unencrypted by design; see db.ts). */
export interface TransactionTagBackup {
	id: string;
	transactionId: string;
	tagId: string;
}

export interface BackupPayload {
	schemaVersion: string;
	exportedEntities: {
		accounts: Account[];
		categories: Category[];
		merchants: Merchant[];
		merchantAliases: MerchantAlias[];
		tags: Tag[];
		transactions: Transaction[];
		transactionSplits: TransactionSplit[];
		transactionTags: TransactionTagBackup[];
		budgets: Budget[];
		budgetItems: BudgetItem[];
		recurringRules: RecurringRule[];
		expectedEvents: ExpectedEvent[];
		investmentHoldings: InvestmentHolding[];
		investmentValuations: InvestmentValuation[];
		liabilities: Liability[];
		netWorthSnapshots: NetWorthSnapshot[];
		debtPlannerPreference: DebtPlannerPreference | null;
		savingsGoals: SavingsGoal[];
		goalContributions: GoalContribution[];
		notificationPreference: NotificationPreference | null;
		notifiedItems: NotifiedItem[];
		attachments: Attachment[];
		categorizationRules: CategorizationRule[];
		merchantCategorySignals: MerchantCategorySignal[];
		userProfile: UserProfile | null;
	};
}

export interface BackupFile {
	container: string;
	containerVersion: number;
	schemaVersion: string;
	createdAt: string;
	checksum: string;
	kdf: { algorithm: 'PBKDF2-SHA256'; iterations: number; salt: string };
	cipher: { algorithm: 'AES-GCM'; iv: string };
	ciphertext: string;
}

const MIGRATIONS: Record<string, (payload: BackupPayload) => BackupPayload> = {
	'1.0.0': migrateFromV1,
	'1.1.0': migrateFromV1_1,
	'1.2.0': migrateFromV1_2,
	'1.3.0': migrateFromV1_3
};

/** Gathers every entity behind the encryption boundary into one plaintext payload. */
async function collectPayload(key: CryptoKey): Promise<BackupPayload> {
	const [
		accounts,
		categories,
		merchants,
		merchantAliases,
		tags,
		transactions,
		transactionSplits,
		transactionTags,
		budgets,
		budgetItems,
		recurringRules,
		expectedEvents,
		investmentHoldings,
		investmentValuations,
		liabilities,
		netWorthSnapshots,
		debtPlannerPreference,
		savingsGoals,
		goalContributions,
		notificationPreference,
		notifiedItems,
		attachments,
		categorizationRules,
		merchantCategorySignals,
		userProfile
	] = await Promise.all([
		decryptRows<AccountRow, Account>(key, await db.accounts.toArray()),
		decryptRows<CategoryRow, Category>(key, await db.categories.toArray()),
		decryptRows<MerchantRow, Merchant>(key, await db.merchants.toArray()),
		decryptRows<MerchantAliasRow, MerchantAlias>(key, await db.merchantAliases.toArray()),
		decryptRows<TagRow, Tag>(key, await db.tags.toArray()),
		decryptRows<TransactionRow, Transaction>(key, await db.transactions.toArray()),
		decryptRows<TransactionSplitRow, TransactionSplit>(key, await db.transactionSplits.toArray()),
		db.transactionTags.toArray() as Promise<TransactionTagBackup[]>,
		decryptRows<BudgetRow, Budget>(key, await db.budgets.toArray()),
		decryptRows<BudgetItemRow, BudgetItem>(key, await db.budgetItems.toArray()),
		decryptRows<RecurringRuleRow, RecurringRule>(key, await db.recurringRules.toArray()),
		decryptRows<ExpectedEventRow, ExpectedEvent>(key, await db.expectedEvents.toArray()),
		decryptRows<InvestmentHoldingRow, InvestmentHolding>(
			key,
			await db.investmentHoldings.toArray()
		),
		decryptRows<InvestmentValuationRow, InvestmentValuation>(
			key,
			await db.investmentValuations.toArray()
		),
		decryptRows<LiabilityRow, Liability>(key, await db.liabilities.toArray()),
		decryptRows<NetWorthSnapshotRow, NetWorthSnapshot>(key, await db.netWorthSnapshots.toArray()),
		getDecrypted<DebtPlannerPreferenceRow, DebtPlannerPreference>(
			db.debtPlannerPreferences,
			key,
			PREFERENCE_ID
		),
		decryptRows<SavingsGoalRow, SavingsGoal>(key, await db.savingsGoals.toArray()),
		decryptRows<GoalContributionRow, GoalContribution>(key, await db.goalContributions.toArray()),
		getDecrypted<NotificationPreferenceRow, NotificationPreference>(
			db.notificationPreferences,
			key,
			PREFERENCE_ID
		),
		decryptRows<NotifiedItemRow, NotifiedItem>(key, await db.notifiedItems.toArray()),
		decryptRows<AttachmentRow, Attachment>(key, await db.attachments.toArray()),
		decryptRows<CategorizationRuleRow, CategorizationRule>(
			key,
			await db.categorizationRules.toArray()
		),
		decryptRows<MerchantCategorySignalRow, MerchantCategorySignal>(
			key,
			await db.merchantCategorySignals.toArray()
		),
		db.userProfile.get('local-user')
	]);

	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		exportedEntities: {
			accounts,
			categories,
			merchants,
			merchantAliases,
			tags,
			transactions,
			transactionSplits,
			transactionTags,
			budgets,
			budgetItems,
			recurringRules,
			expectedEvents,
			investmentHoldings,
			investmentValuations,
			liabilities,
			netWorthSnapshots,
			debtPlannerPreference: debtPlannerPreference ?? null,
			savingsGoals,
			goalContributions,
			notificationPreference: notificationPreference ?? null,
			notifiedItems,
			attachments,
			categorizationRules,
			merchantCategorySignals,
			userProfile: userProfile ?? null
		}
	};
}

/**
 * Creates a full encrypted backup (FR-040, FR-043): the same key already derived from the
 * user's PIN encrypts the whole plaintext payload, and `kdf.salt` records the salt needed
 * to re-derive that key on restore (contracts/backup-format.md).
 */
export async function createBackup(
	key: CryptoKey,
	encryptionSaltBase64: string
): Promise<BackupFile> {
	const payload = await collectPayload(key);
	const checksum = await sha256Hex(JSON.stringify(payload));
	const { iv, ciphertext } = await encrypt(key, payload);

	return {
		container: CONTAINER,
		containerVersion: CONTAINER_VERSION,
		schemaVersion: payload.schemaVersion,
		createdAt: new Date().toISOString(),
		checksum,
		kdf: { algorithm: 'PBKDF2-SHA256', iterations: 210_000, salt: encryptionSaltBase64 },
		cipher: { algorithm: 'AES-GCM', iv },
		ciphertext
	};
}

export class BackupValidationError extends Error {}

/**
 * Validates and decrypts a backup file per contracts/backup-format.md's restore steps 1-4:
 * unrecognized container, a bad PIN/corrupted ciphertext, a checksum mismatch, or an
 * unsupported schema version are all reported as a single generic error each — nothing is
 * written to IndexedDB here, so a failed validation never touches existing data.
 */
export async function validateAndDecryptBackup(
	file: BackupFile,
	pin: string
): Promise<{ payload: BackupPayload; key: CryptoKey }> {
	if (file.container !== CONTAINER || file.containerVersion !== CONTAINER_VERSION) {
		throw new BackupValidationError('This file is not a recognized backup.');
	}

	const key = await deriveEncryptionKey(pin, file.kdf.salt);
	let payload: BackupPayload;
	try {
		payload = await decrypt<BackupPayload>(key, {
			iv: file.cipher.iv,
			ciphertext: file.ciphertext
		});
	} catch {
		throw new BackupValidationError('Incorrect PIN or corrupted backup file.');
	}

	const checksum = await sha256Hex(JSON.stringify(payload));
	if (checksum !== file.checksum) {
		throw new BackupValidationError('Incorrect PIN or corrupted backup file.');
	}

	const migrate = MIGRATIONS[payload.schemaVersion];
	if (!migrate) {
		throw new BackupValidationError('This backup was made with an unsupported app version.');
	}
	return { payload: migrate(payload), key };
}

/**
 * Replaces the entire local database with a validated backup payload (FR-041), re-encrypting
 * every row with `key` first — Dexie loses its transaction scope across an awaited Web
 * Crypto call (see encryptedTable.ts), so all encryption happens before the single
 * all-or-nothing `db.transaction(...)` that actually writes anything.
 */
export async function restoreBackup(key: CryptoKey, payload: BackupPayload): Promise<void> {
	const e = payload.exportedEntities;

	const [
		accountRows,
		categoryRows,
		merchantRows,
		merchantAliasRows,
		tagRows,
		transactionRows,
		splitRows,
		budgetRows,
		budgetItemRows,
		recurringRuleRows,
		expectedEventRows,
		investmentHoldingRows,
		investmentValuationRows,
		liabilityRows,
		netWorthSnapshotRows,
		debtPlannerPreferenceRow,
		savingsGoalRows,
		goalContributionRows,
		notificationPreferenceRow,
		notifiedItemRows,
		attachmentRows,
		categorizationRuleRows,
		merchantCategorySignalRows
	] = await Promise.all([
		Promise.all(
			e.accounts.map((a) =>
				encryptRow<AccountRow, Account>(key, a, { deletedAt: deletedAtIndex(a.deletedAt) })
			)
		),
		Promise.all(
			e.categories.map((c) =>
				encryptRow<CategoryRow, Category>(key, c, {
					parentId: nullableIdIndex(c.parentId),
					deletedAt: deletedAtIndex(c.deletedAt)
				})
			)
		),
		Promise.all(
			e.merchants.map((m) =>
				encryptRow<MerchantRow, Merchant>(key, m, { deletedAt: deletedAtIndex(m.deletedAt) })
			)
		),
		Promise.all(
			e.merchantAliases.map((a) =>
				encryptRow<MerchantAliasRow, MerchantAlias>(key, a, {
					merchantId: a.merchantId,
					aliasText: a.aliasText
				})
			)
		),
		Promise.all(e.tags.map((t) => encryptRow<TagRow, Tag>(key, t, { name: t.name }))),
		Promise.all(
			e.transactions.map((t) =>
				encryptRow<TransactionRow, Transaction>(key, t, {
					accountId: t.accountId,
					date: t.date,
					deletedAt: deletedAtIndex(t.deletedAt),
					reviewStatus: t.reviewStatus,
					duplicateOfId: nullableIdIndex(t.duplicateOfId),
					transferPairId: nullableIdIndex(t.transferPairId)
				})
			)
		),
		Promise.all(
			e.transactionSplits.map((s) =>
				encryptRow<TransactionSplitRow, TransactionSplit>(key, s, {
					transactionId: s.transactionId,
					categoryId: s.categoryId
				})
			)
		),
		Promise.all(
			e.budgets.map((b) => encryptRow<BudgetRow, Budget>(key, b, { categoryId: b.categoryId }))
		),
		Promise.all(
			e.budgetItems.map((i) =>
				encryptRow<BudgetItemRow, BudgetItem>(key, i, {
					budgetId: i.budgetId,
					periodStart: i.periodStart,
					periodEnd: i.periodEnd
				})
			)
		),
		Promise.all(
			e.recurringRules.map((r) =>
				encryptRow<RecurringRuleRow, RecurringRule>(key, r, {
					accountId: r.accountId,
					categoryId: r.categoryId,
					isActive: r.isActive ? 1 : 0
				})
			)
		),
		Promise.all(
			e.expectedEvents.map((ev) =>
				encryptRow<ExpectedEventRow, ExpectedEvent>(key, ev, {
					recurringRuleId: ev.recurringRuleId,
					expectedDate: ev.expectedDate,
					status: ev.status
				})
			)
		),
		Promise.all(
			e.investmentHoldings.map((h) =>
				encryptRow<InvestmentHoldingRow, InvestmentHolding>(key, h, {
					deletedAt: deletedAtIndex(h.deletedAt)
				})
			)
		),
		Promise.all(
			e.investmentValuations.map((v) =>
				encryptRow<InvestmentValuationRow, InvestmentValuation>(key, v, {
					holdingId: v.holdingId,
					date: v.date
				})
			)
		),
		Promise.all(
			e.liabilities.map((l) =>
				encryptRow<LiabilityRow, Liability>(key, l, { deletedAt: deletedAtIndex(l.deletedAt) })
			)
		),
		Promise.all(
			e.netWorthSnapshots.map((s) =>
				encryptRow<NetWorthSnapshotRow, NetWorthSnapshot>(key, s, { date: s.date })
			)
		),
		e.debtPlannerPreference
			? encryptRow<DebtPlannerPreferenceRow, DebtPlannerPreference>(
					key,
					e.debtPlannerPreference,
					{}
				)
			: Promise.resolve(null),
		Promise.all(
			e.savingsGoals.map((g) =>
				encryptRow<SavingsGoalRow, SavingsGoal>(key, g, { deletedAt: deletedAtIndex(g.deletedAt) })
			)
		),
		Promise.all(
			e.goalContributions.map((c) =>
				encryptRow<GoalContributionRow, GoalContribution>(key, c, {
					goalId: c.goalId,
					date: c.date
				})
			)
		),
		e.notificationPreference
			? encryptRow<NotificationPreferenceRow, NotificationPreference>(
					key,
					e.notificationPreference,
					{}
				)
			: Promise.resolve(null),
		Promise.all(
			e.notifiedItems.map((n) => encryptRow<NotifiedItemRow, NotifiedItem>(key, n, { key: n.key }))
		),
		Promise.all(
			e.attachments.map((a) =>
				encryptRow<AttachmentRow, Attachment>(key, a, { transactionId: a.transactionId })
			)
		),
		Promise.all(
			e.categorizationRules.map((r) =>
				encryptRow<CategorizationRuleRow, CategorizationRule>(key, r, {
					merchantId: r.merchantId,
					deletedAt: deletedAtIndex(r.deletedAt)
				})
			)
		),
		Promise.all(
			e.merchantCategorySignals.map((s) =>
				encryptRow<MerchantCategorySignalRow, MerchantCategorySignal>(key, s, {})
			)
		)
	]);

	const transactionTagRows: TransactionTagRow[] = e.transactionTags.map((t) => ({
		id: t.id,
		transactionId: t.transactionId,
		tagId: t.tagId
	}));

	await db.transaction(
		'rw',
		[
			db.accounts,
			db.categories,
			db.merchants,
			db.merchantAliases,
			db.tags,
			db.transactions,
			db.transactionSplits,
			db.transactionTags,
			db.budgets,
			db.budgetItems,
			db.recurringRules,
			db.expectedEvents,
			db.investmentHoldings,
			db.investmentValuations,
			db.liabilities,
			db.netWorthSnapshots,
			db.debtPlannerPreferences,
			db.savingsGoals,
			db.goalContributions,
			db.notificationPreferences,
			db.notifiedItems,
			db.attachments,
			db.categorizationRules,
			db.merchantCategorySignals,
			db.userProfile
		],
		async () => {
			await Promise.all([
				db.accounts.clear(),
				db.categories.clear(),
				db.merchants.clear(),
				db.merchantAliases.clear(),
				db.tags.clear(),
				db.transactions.clear(),
				db.transactionSplits.clear(),
				db.transactionTags.clear(),
				db.budgets.clear(),
				db.budgetItems.clear(),
				db.recurringRules.clear(),
				db.expectedEvents.clear(),
				db.investmentHoldings.clear(),
				db.investmentValuations.clear(),
				db.liabilities.clear(),
				db.netWorthSnapshots.clear(),
				db.debtPlannerPreferences.clear(),
				db.savingsGoals.clear(),
				db.goalContributions.clear(),
				db.notificationPreferences.clear(),
				db.notifiedItems.clear(),
				db.attachments.clear(),
				db.categorizationRules.clear(),
				db.merchantCategorySignals.clear(),
				db.userProfile.clear()
			]);
			await Promise.all([
				db.accounts.bulkPut(accountRows),
				db.categories.bulkPut(categoryRows),
				db.merchants.bulkPut(merchantRows),
				db.merchantAliases.bulkPut(merchantAliasRows),
				db.tags.bulkPut(tagRows),
				db.transactions.bulkPut(transactionRows),
				db.transactionSplits.bulkPut(splitRows),
				db.transactionTags.bulkPut(transactionTagRows),
				db.budgets.bulkPut(budgetRows),
				db.budgetItems.bulkPut(budgetItemRows),
				db.recurringRules.bulkPut(recurringRuleRows),
				db.expectedEvents.bulkPut(expectedEventRows),
				db.investmentHoldings.bulkPut(investmentHoldingRows),
				db.investmentValuations.bulkPut(investmentValuationRows),
				db.liabilities.bulkPut(liabilityRows),
				db.netWorthSnapshots.bulkPut(netWorthSnapshotRows),
				db.savingsGoals.bulkPut(savingsGoalRows),
				db.goalContributions.bulkPut(goalContributionRows),
				db.notifiedItems.bulkPut(notifiedItemRows),
				db.attachments.bulkPut(attachmentRows),
				db.categorizationRules.bulkPut(categorizationRuleRows),
				db.merchantCategorySignals.bulkPut(merchantCategorySignalRows),
				...(debtPlannerPreferenceRow
					? [db.debtPlannerPreferences.add(debtPlannerPreferenceRow)]
					: []),
				...(notificationPreferenceRow
					? [db.notificationPreferences.add(notificationPreferenceRow)]
					: []),
				...(e.userProfile ? [db.userProfile.add(e.userProfile)] : [])
			]);
		}
	);
}
