import type {
	Account,
	Attachment,
	Budget,
	BudgetItem,
	CategorizationRule,
	Category,
	DebtPlannerPreference,
	ExpectedEvent,
	GoalContribution,
	InvestmentHolding,
	InvestmentValuation,
	Liability,
	LoanRepayment,
	Merchant,
	MerchantAlias,
	MerchantCategorySignal,
	NetWorthSnapshot,
	NotificationPreference,
	Person,
	PersonLoan,
	RecurringRule,
	SavedFilterView,
	SavingsGoal,
	Tag,
	Transaction,
	TransactionSplit,
	TransactionTag
} from '../../domain/entities';

export interface DataTemplateEntities {
	accounts: Account[];
	categories: Category[];
	merchants: Merchant[];
	merchantAliases: MerchantAlias[];
	tags: Tag[];
	investmentHoldings: InvestmentHolding[];
	investmentValuations: InvestmentValuation[];
	liabilities: Liability[];
	netWorthSnapshots: NetWorthSnapshot[];
	savingsGoals: SavingsGoal[];
	goalContributions: GoalContribution[];
	budgets: Budget[];
	budgetItems: BudgetItem[];
	recurringRules: RecurringRule[];
	expectedEvents: ExpectedEvent[];
	categorizationRules: CategorizationRule[];
	merchantCategorySignals: MerchantCategorySignal[];
	notificationPreference: NotificationPreference | null;
	debtPlannerPreference: DebtPlannerPreference | null;
	transactions: Transaction[];
	transactionSplits: TransactionSplit[];
	transactionTags: TransactionTag[];
	attachments: Attachment[];
	people?: Person[];
	personLoans?: PersonLoan[];
	loanRepayments?: LoanRepayment[];
	savedFilterViews?: SavedFilterView[];
}

export interface DataTemplate {
	container: 'myfin-data-template';
	templateVersion: number;
	exportedAt: string;
	entities: DataTemplateEntities;
}

export interface EntityImportStats {
	created: number;
	skipped: number;
	flaggedDuplicate?: number;
}

export interface SkippedReason {
	entity: string;
	reason: 'already-exists' | 'unresolved-relationship';
	identifier?: string;
}

export interface TemplateImportResult {
	perEntity: Record<string, EntityImportStats>;
	skippedReasons: SkippedReason[];
	rejected?: string;
}

export type ParseTemplateResult =
	| { ok: true; template: DataTemplate }
	| { ok: false; message: string };
