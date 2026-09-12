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

export interface Budget extends Timestamped {
	id: ID;
	categoryId: ID;
	periodType: BudgetPeriodType;
	amount: number;
	rolloverEnabled: boolean;
	isSinkingFund: boolean;
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
}

export type ExpectedEventStatus = 'pending' | 'matched' | 'missed';

export interface ExpectedEvent extends Timestamped {
	id: ID;
	recurringRuleId: ID;
	expectedDate: ISODateString;
	status: ExpectedEventStatus;
	matchedTransactionId: ID | null;
}

export interface InvestmentHolding extends Timestamped, SoftDeletable {
	id: ID;
	name: string;
	type: string;
	costBasis: number;
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
}

export const DEFAULT_AUTO_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // FR-003, spec clarification

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
