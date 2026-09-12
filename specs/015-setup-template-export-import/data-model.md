# Phase 1 Data Model: Complete Data Template Export & Import

This feature introduces no new persisted Dexie entity or schema change — it reads and writes
exclusively through the repositories every existing entity already has. The only new "data
model" is the shape of the portable file itself and the transient result of an import.

## Data Template (the file)

A single JSON document, structurally modeled on `backupService.ts`'s existing internal
container shape but **unencrypted** and **without `userProfile`**:

```ts
interface DataTemplate {
	container: 'myfin-data-template';
	templateVersion: number; // starts at 1; additive-only, mirrors db.ts's version discipline
	exportedAt: string; // ISO datetime, informational only
	entities: {
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
	};
}
```

Every entity is included in its plain, decrypted domain shape (`Account`, `Category`, etc.
from `src/domain/entities.ts`) — the same shapes already used throughout the app — not the
encrypted `*Row` shape those entities are stored as on disk. **Never included**: `UserProfile`
(PIN verifier, salts, biometric/WebAuthn enrollment — research.md §1/FR-004), `SessionKeyRow`
(a non-extractable, non-serializable `CryptoKey` handle — technically impossible to include,
not a policy choice), `BackupRecord` (metadata *about* full encrypted backups, not user data).
Soft-deleted rows (`deletedAt !== null`) are excluded from every list (research.md §4).

## Per-entity import identity (the "is this a duplicate?" key)

Every entity except transactions uses **skip-if-exists** matching (FR-007); transactions use
**flag-if-matches, always create** (FR-008, research.md §3). Matching is case-insensitive
where it involves a name.

| Entity | Matched by | Notes |
| --- | --- | --- |
| Account | `name` | |
| Category | `name` + resolved `parentId` (via id-remap) | Unresolvable parent → create as top-level, reported (existing Edge Case) |
| Merchant | `name` | |
| MerchantAlias | remapped `merchantId` + `aliasText` | |
| Tag | `name` | Reuses existing `TagRepository.getOrCreate` directly |
| InvestmentHolding | `name` | |
| InvestmentValuation | remapped `holdingId` + `date` | |
| Liability | `name` | |
| NetWorthSnapshot | `date` | |
| SavingsGoal | `name` | |
| GoalContribution | remapped `goalId` + `date` + `amount` | |
| Budget | remapped `categoryId` + `periodType` | |
| BudgetItem | remapped `budgetId` + `periodStart` | |
| RecurringRule | remapped `accountId` + `categoryId` + `amount` + `frequency` + `dayOfPeriod` | |
| ExpectedEvent | remapped `recurringRuleId` + `expectedDate` | |
| CategorizationRule | remapped `merchantId` + `merchantAliasId` + `categoryId` | |
| MerchantCategorySignal | remapped merchant id (the record's own `id`) | **Merged**, not skip/create — research.md §7 |
| NotificationPreference | singleton (`id: 'local-user'`) | Skip if one already exists — research.md §5 |
| DebtPlannerPreference | singleton (`id: 'local-user'`) | Skip if one already exists — research.md §5 |
| Transaction | remapped `accountId` + `date` (±1 day) + `amount` | Always created; matched ones get `duplicateOfId` set and `reviewStatus: 'unreviewed'`, exactly like ordinary file import (research.md §3) |
| TransactionSplit | belongs to its (always-created) transaction | Category ids remapped |
| TransactionTag | belongs to its (always-created) transaction | Tag ids remapped |
| Attachment | belongs to its transaction | Skipped, reported, if that transaction's identity resolved to a **pre-existing** transaction rather than one newly created this import (existing Edge Case) — attaching a file's receipt image to an unrelated existing transaction would be silently wrong |

## Import Result Summary

```ts
interface TemplateImportResult {
	perEntity: Record<
		string, // entity key, e.g. "accounts", "transactions"
		{ created: number; skipped: number; flaggedDuplicate?: number }
	>;
	skippedReasons: { entity: string; reason: 'already-exists' | 'unresolved-relationship' }[];
	rejected?: string; // set instead of the above when FR-009's structural validation fails
}
```

Rendered in the UI as the per-kind created/skipped/flagged breakdown FR-011 requires.

## Relationships preserved across the file (dependency/processing order, research.md §2)

```text
Account, Merchant, Tag, InvestmentHolding, Liability, SavingsGoal   (no dependencies)
        |
        v
Category (parentId -> Category)
        |
        v
MerchantAlias (-> Merchant), InvestmentValuation (-> InvestmentHolding),
GoalContribution (-> SavingsGoal), NetWorthSnapshot (none, but ordered here for simplicity)
        |
        v
Budget (-> Category)  -->  BudgetItem (-> Budget)
RecurringRule (-> Account, Category)  -->  ExpectedEvent (-> RecurringRule)
CategorizationRule (-> Merchant, MerchantAlias, Category)  -->  MerchantCategorySignal (-> Merchant)
        |
        v
Transaction (-> Account)
        |
        v
TransactionSplit (-> Transaction, Category), TransactionTag (-> Transaction, Tag),
Attachment (-> Transaction, only if newly created)
```

No new Dexie schema version is introduced by this feature — every read/write goes through
existing repositories and existing tables.
