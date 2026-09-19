// Plaintext entity shapes shared by the domain and data layers.
// See specs/001-personal-finance-manager/data-model.md for the authoritative definitions.
// Monetary fields are always integers in the smallest currency unit (never floating point).

export type ID = string;
export type ISODateString = string; // e.g. "2026-09-06"
export type EpochMillis = number;

export interface SoftDeletable {
	deletedAt: EpochMillis | null;
}

export interface Timestamped {
	createdAt: EpochMillis;
	updatedAt: EpochMillis;
}

export type AccountType = 'bank' | 'cash' | 'wallet' | 'credit_card';

export interface Account extends Timestamped, SoftDeletable {
	id: ID;
	name: string;
	type: AccountType;
	openingBalance: number;
	currentBalance: number;
	creditLimit: number | null;
	billingCycleDay: number | null;
	isArchived: boolean;
	/** Last 4 digits of the card number, meaningful only for `type === 'credit_card'` (spec 017,
	 *  FR-019). Used both by `findLikelyDuplicateAccounts` (FR-008) and by
	 *  `cardIdentifierMatcher.findCardMatches` (FR-020) to auto-match imported/pasted
	 *  transactions to the right card. Exactly 4 digits when set. Optional (like
	 *  `InvestmentHolding.units`, spec 016) so every pre-existing `AccountRepository.create` call
	 *  site — most of which predate this field — keeps compiling unchanged; `undefined` and
	 *  `null` are both treated as "untagged". */
	cardLast4?: string | null;
	/** A user-chosen nickname for a credit card account, meaningful only for
	 *  `type === 'credit_card'` (spec 017, FR-019) — same two consumers and optionality as
	 *  `cardLast4`. */
	cardNickname?: string | null;
	/** User-configured low-balance warning threshold for cash-flow forecasting (spec 019,
	 *  FR-008), in the smallest currency unit. Optional — absent/undefined means the default
	 *  of 0 (forecastEngine.ts). */
	lowBalanceThresholdMinor?: number;
}

export interface Category extends Timestamped, SoftDeletable {
	id: ID;
	name: string;
	parentId: ID | null;
	icon: string | null;
}

export interface Merchant extends Timestamped, SoftDeletable {
	id: ID;
	name: string;
	/** Set when the user dismisses this merchant from the auto-detected Subscriptions view
	 *  (spec 019, FR-005). Optional so every existing Merchant row (all predating this field)
	 *  keeps loading unchanged; absent/false means "not dismissed". */
	subscriptionDismissed?: boolean;
}

export interface MerchantAlias extends Timestamped {
	id: ID;
	merchantId: ID;
	aliasText: string;
}

export interface Tag extends Timestamped {
	id: ID;
	name: string;
}

export type TransactionType = 'income' | 'expense' | 'transfer';
export type TransactionSource = 'manual' | 'quick_add' | 'bulk_import' | 'file_import';
export type ReviewStatus = 'confirmed' | 'unreviewed';

export interface Transaction extends Timestamped, SoftDeletable {
	id: ID;
	accountId: ID;
	date: ISODateString;
	amount: number; // positive = income, negative = expense (see transactionEngine.ts)
	type: TransactionType;
	transferPairId: ID | null;
	merchantId: ID | null;
	notes: string | null;
	source: TransactionSource;
	reviewStatus: ReviewStatus;
	duplicateOfId: ID | null;
	/** Set when this transaction was the source of a recurring rule created via Review's
	 *  "Mark as Recurring" (FR-005, spec 016). null/undefined for every transaction not
	 *  linked this way. Not indexed — read directly off the already-decrypted object. */
	recurringRuleId?: ID | null;
}

export interface TransactionSplit {
	id: ID;
	transactionId: ID;
	categoryId: ID;
	amount: number;
	/** Set only when this split's category was auto-filled by the categorization engine
	 *  (spec 006); absent for a manually chosen category. Never influences persistence —
	 *  purely a provenance hint for the Review Queue UI and the learning signal. */
	categorizationSource?: 'rule' | 'suggestion';
}

export interface TransactionTag {
	transactionId: ID;
	tagId: ID;
}

export type BudgetPeriodType = 'monthly' | 'yearly';

export type BudgetRolloverMode = 'off' | 'positive-only' | 'full';

export interface Budget extends Timestamped, SoftDeletable {
	id: ID;
	categoryId: ID;
	periodType: BudgetPeriodType;
	amount: number;
	rolloverEnabled: boolean;
	isSinkingFund: boolean;
	/** Envelope rollover mode (spec 019, FR-013–FR-017). Optional: when absent, the effective
	 *  mode is derived from the legacy `rolloverEnabled` boolean ('positive-only' if true, 'off'
	 *  if false) — see budgetEngine.ts — so every pre-existing Budget row keeps its current
	 *  behavior unchanged with no data migration. 'full' additionally carries a deficit
	 *  (overspend) forward, which `rolloverEnabled` alone never did. */
	rolloverMode?: BudgetRolloverMode;
}

export interface BudgetItem extends Timestamped {
	id: ID;
	budgetId: ID;
	periodStart: ISODateString;
	periodEnd: ISODateString;
	plannedAmount: number;
	actualAmount: number;
	rolloverInAmount: number;
}

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurringRule extends Timestamped {
	id: ID;
	accountId: ID;
	categoryId: ID;
	amount: number;
	frequency: RecurringFrequency;
	dayOfPeriod: number;
	isActive: boolean;
	/** Human-readable description, copied from the source transaction's notes when created
	 *  via createRuleFromTransaction (FR-005, spec 016). Display falls back to category-name
	 *  rendering when absent. Not indexed. */
	label?: string;
}

export type ExpectedEventStatus = 'pending' | 'matched' | 'missed';

export interface ExpectedEvent extends Timestamped {
	id: ID;
	recurringRuleId: ID;
	expectedDate: ISODateString;
	status: ExpectedEventStatus;
	matchedTransactionId: ID | null;
}

export type InvestmentType =
	'stock' | 'mutual_fund' | 'etf' | 'bond' | 'fixed_deposit' | 'crypto' | 'other';

export interface InvestmentHolding extends Timestamped, SoftDeletable {
	id: ID;
	name: string;
	type: InvestmentType;
	costBasis: number;
	/** Count of units held. Present once a holding has gone through the purchase/sale flow;
	 *  undefined for a legacy holding that only ever had a costBasis (FR-018). */
	units?: number;
	/** Average price per unit, integer in the smallest currency unit (paise). Present under
	 *  the same condition as units. */
	avgPrice?: number;
}

export interface InvestmentValuation extends Timestamped {
	id: ID;
	holdingId: ID;
	date: ISODateString;
	value: number;
}

export type LiabilityType = 'loan' | 'credit_card';

export interface Liability extends Timestamped, SoftDeletable {
	id: ID;
	name: string;
	type: LiabilityType;
	outstandingBalance: number;
	emiAmount: number | null;
	emiDueDay: number | null;
	/** Annual rate in basis points (e.g. 1850 = 18.50% APR); null until supplied for the debt payoff planner. */
	interestRate: number | null;
	/** Smallest currency unit; null until supplied for the debt payoff planner (defaults from emiAmount for loans). */
	minimumPayment: number | null;
	/** Set when this liability has been merged into a transaction-linked Account of type
	 *  'credit_card' (spec 017, FR-009) — that Account becomes the single source of truth for
	 *  this debt in net worth (wealthEngine.computeNetWorth excludes it), while this row is kept
	 *  unfiltered everywhere else (Liabilities page, Debt Payoff Planner). */
	linkedAccountId: ID | null;
	/** True once the user has confirmed a name/identifier match flagged by
	 *  findLikelyDuplicateAccounts is NOT the same real card (spec 017, FR-010) — suppresses the
	 *  warning on later views without changing what counts in net worth. */
	duplicateWarningDismissed: boolean;
}

export interface NetWorthSnapshot extends Timestamped {
	id: ID;
	date: ISODateString;
	totalAssets: number;
	totalLiabilities: number;
	netWorth: number;
}

export type PayoffStrategy = 'avalanche' | 'snowball';

/** Singleton — remembers the user's last-used debt payoff planner inputs (spec 002). */
export interface DebtPlannerPreference extends Timestamped {
	id: 'local-user';
	strategy: PayoffStrategy;
	extraMonthlyPayment: number;
}

/** A user-defined savings target (spec 003); progress is always derived, never stored. */
export interface SavingsGoal extends Timestamped, SoftDeletable {
	id: ID;
	name: string;
	targetAmount: number;
	targetDate: ISODateString | null;
}

/** A single logged amount toward a SavingsGoal; may be negative to correct a mistake
 *  (research.md §3, spec 003). No independent soft-delete — see that doc for why. */
export interface GoalContribution extends Timestamped {
	id: ID;
	goalId: ID;
	amount: number;
	date: ISODateString;
}

/** Singleton — governs the on-open recurring/budget notification check (spec 004). */
export interface NotificationPreference extends Timestamped {
	id: 'local-user';
	enabled: boolean;
	reminderLeadDays: number;
	budgetThresholdPercent: number;
	permissionPromptDismissed: boolean;
}

/** Dedupe log entry — prevents re-showing a notification for the same occurrence
 *  (spec 004, research.md §2). Never rendered to the user. */
export interface NotifiedItem extends Timestamped {
	id: ID;
	key: string;
}

/** A receipt/photo attached to a Transaction (spec 005). No independent soft-delete —
 *  visibility is entirely derived from the parent transaction's deletedAt (research.md §5,
 *  the same precedent GoalContribution already established for a single-parent child). */
export interface Attachment extends Timestamped {
	id: ID;
	transactionId: ID;
	mimeType: string;
	/** Base64-encoded, compressed image bytes (no `data:` URL prefix). */
	data: string;
	sizeBytes: number;
}

/** An explicit, user-authored merchant/alias -> category+tags mapping (spec 006, Story 1).
 *  When `merchantAliasId` is set, the rule only matches that one specific alias (the "more
 *  specific" case); when `null`, it matches any alias resolving to `merchantId`. */
export interface CategorizationRule extends Timestamped, SoftDeletable {
	id: ID;
	merchantId: ID;
	merchantAliasId: ID | null;
	categoryId: ID;
	tagIds: ID[];
}

/** Internal, per-merchant learning signal (spec 006, Story 2) — a capped FIFO of the most
 *  recently confirmed categories for this merchant, never longer than `MIN_STREAK` entries
 *  (see categorizationEngine.ts). `id` is the merchant's own id (one row per merchant), not
 *  a fresh UUID. A learned suggestion is always derived from this array, never stored. */
export interface MerchantCategorySignal extends Timestamped {
	id: ID;
	recentCategoryIds: ID[];
}

/** A contact the user lends money to or borrows money from (spec 010). Not linked to phone
 *  contacts or any external directory — purely local app data. */
export interface Person extends Timestamped, SoftDeletable {
	id: ID;
	name: string;
	notes: string | null;
}

export type LoanDirection = 'lent' | 'borrowed';

/** A single lending or borrowing event between the user and a Person (spec 010). Pending
 *  balance is always derived (principal - repayments - writeOffAmount), never stored — same
 *  precedent as SavingsGoal/GoalContribution. `direction`/`principalAmount`/`accountId`/`date`
 *  are immutable after creation (data-model.md): changing them after the linked Transaction
 *  has posted would silently invert or corrupt money already moved. */
export interface PersonLoan extends Timestamped, SoftDeletable {
	id: ID;
	personId: ID;
	direction: LoanDirection;
	principalAmount: number;
	date: ISODateString;
	dueDate: ISODateString | null;
	notes: string | null;
	accountId: ID;
	/** The Transaction this loan's principal movement posted (research.md §1: a single-sided
	 *  `type: 'transfer'` transaction, never null). */
	transactionId: ID;
	/** 0 until written off. Set together with `writeOffAt`, never independently. */
	writeOffAmount: number;
	writeOffAt: EpochMillis | null;
}

/** A single repayment logged against an open PersonLoan (spec 010). */
export interface LoanRepayment extends Timestamped, SoftDeletable {
	id: ID;
	loanId: ID;
	amount: number;
	date: ISODateString;
	accountId: ID;
	/** The Transaction this repayment posted (research.md §1); never null. */
	transactionId: ID;
}

export interface BackupRecord extends Timestamped {
	id: ID;
	schemaVersion: string;
	sizeBytes: number;
	checksum: string;
}

export interface UserProfile {
	id: 'local-user';
	pinVerifierHash: string;
	pinSalt: string;
	encryptionSalt: string;
	biometricEnabled: boolean;
	autoLockTimeoutMs: number;
	storagePersisted: boolean;
	/**
	 * Consecutive failed unlock attempts, and the deadline before which further attempts are
	 * refused. Persisted rather than held in memory so a reload — the obvious way to sidestep
	 * an in-memory counter — does not reset the throttle. See domain/auth/pinPolicy.ts.
	 * Optional so profiles written before this field existed keep loading; absent means zero.
	 */
	failedUnlockAttempts?: number;
	lockedOutUntil?: EpochMillis | null;
	/**
	 * Present only when biometric unlock (FR-002) is enrolled. The PIN, encrypted with a
	 * key derived from the WebAuthn PRF extension output, so a successful biometric
	 * assertion can recover the PIN without the user typing it — the PIN is still what
	 * ultimately derives the data encryption key, so biometric is strictly an alternate
	 * *entry path* to the same PIN-based key, never a bypass of it.
	 */
	webauthn?: {
		credentialId: string; // base64url
		prfSalt: string; // base64, fixed per-installation salt fed into the PRF eval
		wrappedPin: { iv: string; ciphertext: string };
	};
	/** Persisted Dashboard widget order/visibility (spec 019, FR-022/FR-023). Array order is
	 *  display order. Absent, or an empty array, means "use the built-in default" — see
	 *  `resolveDashboardLayout` in `dashboardLayout.ts`, the only place this is interpreted. */
	dashboardLayout?: { widgetId: string; visible: boolean }[];
}

export const DEFAULT_AUTO_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // FR-003, spec clarification

/** Scheduled local encrypted backup config (spec 019, FR-026–FR-031). Singleton, same
 *  `'local-user'` id pattern as `UserProfile`/`DebtPlannerPreference`. Unencrypted by design —
 *  `directoryHandle` is an opaque, non-exportable browser permission object (structured-clone
 *  only, not JSON-serializable), not financial content; the encrypted backup *file* itself is
 *  produced unchanged by the existing `createBackup()` (data-model.md #6, research.md R7). */
export interface AutoBackupSettings {
	id: 'local-user';
	enabled: boolean;
	intervalDays: number;
	directoryHandle?: FileSystemDirectoryHandle;
	lastBackupAt?: string;
	lastBackupStatus?: 'success' | 'failed';
}

/** User-defined filter views for Transactions list. */
export interface SavedFilterView extends Timestamped {
	id: ID;
	name: string;
	accountId: ID | null;
	dateFrom: ISODateString | null;
	dateTo: ISODateString | null;
	freeText: string | null;
	tagIds: ID[];
}
