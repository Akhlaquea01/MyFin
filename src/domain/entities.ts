// Plaintext entity shapes shared by the domain and data layers.
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
	/** Last 3–4 digits of the account number, for matching captured bank messages ("A/c XX1234")
	 *  to this account. Meaningful for any account type; a credit card is matched through
	 *  `cardLast4` as well. Optional like `cardLast4` — absent/null means "untagged". */
	accountLast4?: string | null;
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
export type TransactionSource =
	| 'manual'
	| 'quick_add'
	| 'bulk_import'
	| 'file_import'
	/** A bank SMS captured by the Android app. */
	| 'sms_capture'
	/** A payment-app or bank-app notification captured by the Android app. */
	| 'notification_capture';
export type CaptureChannel = 'sms' | 'notification';

/**
 * Where an automatically captured transaction came from, kept so Review can show the original
 * message next to the parsed values. Deliberately NOT stored in `notes`: `formatTransactionLabel`
 * shows `notes` as the row title, which would turn the whole message into the title.
 */
export interface CaptureInfo {
	channel: CaptureChannel;
	/** SMS sender id (e.g. "VM-HDFCBK"), or the name of the app that posted the notification. */
	sender: string;
	receivedAt: EpochMillis;
	/** The message as received (title and body for a notification). */
	text: string;
	/** Why the account may be wrong: no account number matched, or several did. Cleared once the
	 *  user edits the entry. */
	accountCheck?: 'default-account' | 'unmatched-tail' | null;
	/** The account digits the message mentioned that matched nothing, to help the user pick. */
	tailHint?: string | null;
	/** The bank's UPI/UTR/reference number from the message. The one thing that tells a replayed
	 *  message from a second, identical payment. */
	refNo?: string | null;
	/** The same payment also seen again (the SMS and a payment-app notification, or a messaging
	 *  app's copy of that SMS), folded into this one entry rather than creating another. */
	alsoSeenAs?: { channel: CaptureChannel; sender: string; receivedAt: EpochMillis }[];
}

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
	/** Set only on entries created by automatic capture (Android app). */
	capture?: CaptureInfo | null;
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
	/** Purchases and sales recorded through "Buy more units" / "Sell units", oldest first. Kept ON
	 *  the holding (like a liability's payments) so it needs no schema migration and travels with
	 *  backups. The latest one can be undone. Absent on a holding that has never traded. */
	trades?: InvestmentTrade[];
}

/** How a trade moved the holding's recorded value, in enough detail to put it back: the value
 *  written was either a NEW valuation (to be deleted again) or a replacement of today's existing
 *  one (to be set back to `previousValue`). */
export interface InvestmentValueChange {
	id: ID;
	created: boolean;
	previousValue: number;
}

/** One purchase or sale of units. */
export interface InvestmentTrade {
	id: ID;
	kind: 'buy' | 'sell';
	units: number;
	/** Price per unit in the smallest currency unit. Null for a sale entered without one. */
	price: number | null;
	/** units × price — what moved to or from `accountId`. Null when no price was given. */
	amount: number | null;
	date: ISODateString;
	/** The account the money left or arrived in; null when the trade was not recorded in one. */
	accountId: ID | null;
	/** The ledger entry for that movement — which is what keeps the two from drifting apart; see
	 *  `TransactionRepository.getLoanLink`. Null when `accountId` is. */
	transactionId: ID | null;
	/** The holding as it was before this trade, so undoing it puts everything back exactly. */
	before: { units?: number; avgPrice?: number; costBasis: number };
	/** What the trade did to the recorded value; null when the holding had none to adjust. */
	valueChange: InvestmentValueChange | null;
}

export interface InvestmentValuation extends Timestamped {
	id: ID;
	holdingId: ID;
	date: ISODateString;
	value: number;
}

export type LiabilityType = 'loan' | 'credit_card';

/** One payment made toward a liability from a tracked account. Kept ON the liability (not in a table
 *  of its own) so it needs no schema migration and travels with backups; `transactionId` is the
 *  ledger entry it posted, which is what keeps the two from drifting apart — see
 *  `TransactionRepository.getLoanLink`. */
export interface LiabilityPayment {
	id: ID;
	amount: number;
	date: ISODateString;
	accountId: ID;
	transactionId: ID;
}

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
	/** Payments recorded through "Record payment" (newest last). Absent on every liability that
	 *  predates the feature, and on one that has never been paid from an account. */
	payments?: LiabilityPayment[];
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

/** What kind of reminder an inbox entry is — mirrors `NotificationCandidateKind`. */
export type InboxNotificationKind = 'recurring' | 'budget' | 'personLoan';

/**
 * A reminder kept in the in-app Alerts list. The OS notification is fleeting (and absent entirely
 * when the user has not allowed notifications); this is the record that stays until the user clears
 * it. `dedupeKey` is the same key the notification engine uses, so one occurrence is listed once.
 */
export interface InboxNotification extends Timestamped {
	id: ID;
	dedupeKey: string;
	kind: InboxNotificationKind;
	title: string;
	body: string;
	/** App route the entry opens — the bill, the budget, the loan. */
	route: string;
	readAt: EpochMillis | null;
}

/**
 * A captured bank message that passed the "looks like a transaction" filter but could not be read
 * into an entry. Kept (encrypted, like everything else) so the user can add it by hand instead of
 * losing it.
 */
export interface UnreadableCapture extends Timestamped {
	id: ID;
	channel: CaptureChannel;
	sender: string;
	receivedAt: EpochMillis;
	text: string;
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
	/** The merchant this rule is about — or, for a keyword rule, the sentinel
	 *  `KEYWORD_RULE_MERCHANT_ID` (categorizationRuleRepository.ts), so keyword rules need no extra
	 *  index and no schema migration: they are simply the rules "belonging" to that one pseudo-merchant. */
	merchantId: ID;
	merchantAliasId: ID | null;
	categoryId: ID;
	tagIds: ID[];
	/** Set only on a keyword rule: text that, when it appears in a transaction's description (or
	 *  merchant name), files it under `categoryId`. Stored as the user typed it; compared after
	 *  normalization (keywordMatching.ts). Absent/null on every merchant rule — including every row
	 *  that predates this field. */
	keyword?: string | null;
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
	 * Opt-in: lock as soon as the app has been out of the foreground for a short grace period,
	 * instead of waiting out the inactivity timeout. Absent means off.
	 */
	lockOnBackground?: boolean;
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
	/**
	 * Present only when fingerprint unlock is enrolled in the Android app. WebAuthn does not work
	 * inside Android WebView, so the app uses a native plugin instead: a random secret is held
	 * behind a biometric-bound Keystore key, and this is the PIN wrapped with that secret. The
	 * secret never leaves native storage except through a fingerprint prompt, and the PIN never
	 * reaches native code. A wrapped PIN that no longer opens (profile restored from a backup, key
	 * invalidated) is dropped and the user falls back to the PIN.
	 */
	nativeBiometric?: {
		wrappedPin: { iv: string; ciphertext: string };
		enrolledAt: EpochMillis;
	};
	/** Automatic capture of bank SMS and payment notifications (Android app only). */
	capture?: CaptureSettings;
	/** Persisted Dashboard widget order/visibility (spec 019, FR-022/FR-023). Array order is
	 *  display order. Absent, or an empty array, means "use the built-in default" — see
	 *  `resolveDashboardLayout` in `dashboardLayout.ts`, the only place this is interpreted. */
	dashboardLayout?: { widgetId: string; visible: boolean }[];
}

/**
 * Settings for capturing bank SMS and payment notifications in the Android app. Lives on the
 * profile (a plain singleton) so it needs no new table. The messages themselves are never stored
 * here: native code seals each one with `sealing.publicKey` and queues it; only after unlock does
 * the app open them with the private key, which is kept here encrypted with the data key.
 */
export interface CaptureSettings {
	enabled: boolean;
	sms: boolean;
	notifications: boolean;
	/** Where a message goes when no account number in it matches an account. */
	defaultAccountId: ID | null;
	sealing?: {
		/** RSA-2048 public key, base64 X.509 SubjectPublicKeyInfo — the only thing native holds. */
		publicKey: string;
		/** Identifies this key pair, so items sealed to an old pair can be told apart. */
		keyId: string;
		/** The matching private key (base64 PKCS#8), encrypted with the PIN-derived data key. */
		wrappedPrivateKey: { iv: string; ciphertext: string };
	};
	/** Messages that looked like transactions but could not be read; their text is discarded. */
	unreadableCount?: number;
	/** Messages the phone discarded because too many piled up while MyFin was locked. */
	droppedCount?: number;
	lastDrainAt?: EpochMillis;
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
	/** The Android app's equivalent of `directoryHandle`: the folder the user picked through
	 *  Android's Storage Access Framework. A plain address and name, so it survives JSON like
	 *  everything else here. Exactly one of the two is set. */
	nativeFolder?: { uri: string; name: string };
	lastBackupAt?: string;
	lastBackupStatus?: 'success' | 'failed';
}

/**
 * How the user mapped the columns of one kind of import file, remembered so the next file with the
 * same layout is filled in instead of asked for again. Recognised by `signature` — the file's
 * header names, normalized — never by file name. The destination account is deliberately NOT part
 * of it: which account a file belongs to is a per-file decision (two accounts at one bank export
 * identical layouts), and a remembered wrong account would silently misfile a whole statement.
 * Device-local: not part of backups or templates.
 */
export interface ImportMappingPreset extends Timestamped {
	id: ID;
	/** Order-independent, normalized digest of the file's header names. */
	signature: string;
	dateColumn: string;
	dateFormat: string;
	amountSignConvention: 'negative-is-expense' | 'separate-debit-credit-columns';
	amountColumn: string | null;
	debitColumn: string | null;
	creditColumn: string | null;
	descriptionColumn: string | null;
	accountColumn: string | null;
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
