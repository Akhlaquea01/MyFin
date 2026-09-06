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
}

export interface NetWorthSnapshot extends Timestamped {
	id: ID;
	date: ISODateString;
	totalAssets: number;
	totalLiabilities: number;
	netWorth: number;
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
