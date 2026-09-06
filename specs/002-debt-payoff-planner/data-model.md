# Phase 1 Data Model: Debt Payoff Planner

Conventions follow the core app's data model (see
[../001-personal-finance-manager/data-model.md](../001-personal-finance-manager/data-model.md)):
UUID primary keys, integers for every monetary field, `createdAt`/`updatedAt` timestamps,
nullable `deletedAt` for soft-deletable entities, and AES-GCM-encrypted-at-rest storage for
the plaintext shape described below.

## Liability (existing entity, extended)

Two fields are added to the existing `Liability` entity (see core data-model.md) to support
payoff planning; all other fields are unchanged.

| Field          | Type              | Notes                                                                                                                                                         |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| interestRate   | integer, nullable | Annual rate in basis points (e.g. `1850` = 18.50% APR); `null` means "not yet supplied" (FR-008)                                                              |
| minimumPayment | integer, nullable | Smallest currency unit; for `loan`-type liabilities, defaulted from `emiAmount` when first blank, but independently editable; `null` means "not yet supplied" |

**Validation**: A liability with `interestRate === null` or `minimumPayment === null` is
excluded from plan generation and surfaced to the user as needing input (FR-008); this does
not block any existing Liabilities feature behavior (EMI tracking continues to work off
`emiAmount`/`emiDueDay` regardless of whether planner fields are filled in).

## DebtPlannerPreference (new, singleton-per-installation)

Remembers the user's last-used strategy and extra-payment amount so the plan doesn't reset
every time the planner is opened. Read/written only by this feature; not part of the core
ledger.

| Field               | Type                          | Notes                                         |
| ------------------- | ----------------------------- | --------------------------------------------- |
| id                  | literal `"local-user"`        | Singleton PK, mirrors `UserProfile`'s pattern |
| strategy            | enum: `avalanche`, `snowball` | Defaults to `avalanche` on first use          |
| extraMonthlyPayment | integer                       | Smallest currency unit; defaults to `0`       |
| updatedAt           | timestamp                     |                                               |

## DebtPayoffPlan (derived, not persisted)

Not a stored entity — always computed on demand from current `Liability` records and the
current `DebtPlannerPreference`. Included here to name the shape the domain engine produces,
since it is what the UI and tests consume.

| Field                | Type                          | Notes                                                                                        |
| -------------------- | ----------------------------- | -------------------------------------------------------------------------------------------- |
| strategy             | enum: `avalanche`, `snowball` | Echoes the input strategy                                                                    |
| entries              | `DebtPayoffPlanEntry[]`       | One per included liability, in priority order                                                |
| payoffDate           | date                          | Projected date the last included liability reaches zero balance                              |
| totalInterest        | integer                       | Sum of interest accrued across all entries over the life of the plan                         |
| excludedLiabilityIds | UUID[]                        | Liabilities missing `interestRate`/`minimumPayment` (FR-008), omitted from the above figures |

### DebtPayoffPlanEntry (derived, not persisted)

| Field           | Type                                                                                                                     | Notes                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| liabilityId     | UUID                                                                                                                     | FK → Liability                                                                                                                        |
| priorityOrder   | integer                                                                                                                  | 1-based rank under the active strategy                                                                                                |
| payoffDate      | date                                                                                                                     | Projected date this specific liability reaches zero balance                                                                           |
| totalInterest   | integer                                                                                                                  | Interest accrued on this liability over the life of the plan                                                                          |
| monthlySchedule | `{ month: date, startingBalance: integer, interestAccrued: integer, paymentApplied: integer, endingBalance: integer }[]` | Month-by-month detail backing the summary figures; not necessarily rendered in full by the UI, but what the engine/tests operate over |

## Entity Relationship Summary

```
Liability (extended: interestRate, minimumPayment) ---* DebtPayoffPlanEntry   (derived, in-memory)
DebtPlannerPreference (singleton) ---> DebtPayoffPlan generation input
DebtPayoffPlan 1---* DebtPayoffPlanEntry                                       (derived, in-memory)
```
