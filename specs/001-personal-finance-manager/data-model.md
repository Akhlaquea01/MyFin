# Phase 1 Data Model: Personal Finance Manager (PWA)

Conventions applying to every entity below (Constitution Principle VI):

- Primary key is a `id: string` UUID (`crypto.randomUUID()`).
- All monetary fields are integers in the smallest currency unit (e.g., paise), never
  floating point.
- Every entity has `createdAt` / `updatedAt` timestamps (epoch milliseconds).
- Entities that can be user-deleted have a nullable `deletedAt` timestamp (soft delete);
  `null` means active.
- Every entity's stored representation is the AES-GCM-encrypted JSON of the fields below;
  the fields listed are the plaintext logical shape the domain layer works with, not the
  on-disk encoding.

## Account

Represents a place money is held or owed.

| Field           | Type                                          | Notes                                                                     |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| id              | UUID                                          | PK                                                                        |
| name            | string                                        | User-facing label                                                         |
| type            | enum: `bank`, `cash`, `wallet`, `credit_card` | Drives UI treatment (e.g., credit limit fields)                           |
| openingBalance  | integer                                       | Smallest currency unit                                                    |
| currentBalance  | integer                                       | Derived/maintained field; recalculated by the transaction engine (FR-015) |
| creditLimit     | integer, nullable                             | Only meaningful for `credit_card`                                         |
| billingCycleDay | integer 1-31, nullable                        | Only meaningful for `credit_card`                                         |
| isArchived      | boolean                                       | Deactivated but retained for history (distinct from soft delete)          |
| deletedAt       | timestamp, nullable                           | Soft delete; blocked while active transactions reference it (Edge Case)   |

**Validation**: An account with any non-deleted transactions cannot be hard-deleted (Edge
Case in spec.md); `isArchived` is the intended path for "retiring" an account still in use.

## Category

Hierarchical label for classifying transactions and budgets.

| Field     | Type                | Notes                                       |
| --------- | ------------------- | ------------------------------------------- |
| id        | UUID                | PK                                          |
| name      | string              |                                             |
| parentId  | UUID, nullable      | Self-referential; null = top-level category |
| icon      | string, nullable    | Icon identifier                             |
| deletedAt | timestamp, nullable | Soft delete                                 |

## Merchant

The counterparty of a transaction.

| Field     | Type                | Notes                  |
| --------- | ------------------- | ---------------------- |
| id        | UUID                | PK                     |
| name      | string              | Canonical display name |
| deletedAt | timestamp, nullable | Soft delete            |

## MerchantAlias

Maps a raw string seen in parsed text to a canonical Merchant.

| Field      | Type   | Notes                                                    |
| ---------- | ------ | -------------------------------------------------------- |
| id         | UUID   | PK                                                       |
| merchantId | UUID   | FK → Merchant                                            |
| aliasText  | string | Raw text as seen in a parsed message; indexed for lookup |

## Tag

Free-form cross-cutting label.

| Field | Type   | Notes                   |
| ----- | ------ | ----------------------- |
| id    | UUID   | PK                      |
| name  | string | Unique per installation |

## Transaction

A single dated money movement.

| Field          | Type                                                      | Notes                                                                          |
| -------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| id             | UUID                                                      | PK                                                                             |
| accountId      | UUID                                                      | FK → Account                                                                   |
| date           | date (ISO string)                                         |                                                                                |
| amount         | integer                                                   | Smallest currency unit; sign convention: positive = income, negative = expense |
| type           | enum: `income`, `expense`, `transfer`                     |                                                                                |
| transferPairId | UUID, nullable                                            | Links the two Transaction rows that make up one transfer (FR-011)              |
| merchantId     | UUID, nullable                                            | FK → Merchant                                                                  |
| notes          | string, nullable                                          |                                                                                |
| source         | enum: `manual`, `quick_add`, `bulk_import`, `file_import` | Provenance, per spec §7/US4                                                    |
| reviewStatus   | enum: `confirmed`, `unreviewed`                           | Drives the review queue (FR-022)                                               |
| duplicateOfId  | UUID, nullable                                            | Set when flagged as a likely duplicate pending user decision (FR-020/038)      |
| deletedAt      | timestamp, nullable                                       | Soft delete → trash (FR-014)                                                   |

### TransactionSplit

A transaction may be divided across multiple categories; if unsplit, exactly one implicit
split record covers the full amount.

| Field         | Type    | Notes                                                                     |
| ------------- | ------- | ------------------------------------------------------------------------- |
| id            | UUID    | PK                                                                        |
| transactionId | UUID    | FK → Transaction                                                          |
| categoryId    | UUID    | FK → Category                                                             |
| amount        | integer | Splits for a transaction MUST sum to that transaction's `amount` (FR-009) |

### TransactionTag

Join table between Transaction and Tag.

| Field         | Type | Notes            |
| ------------- | ---- | ---------------- |
| transactionId | UUID | FK → Transaction |
| tagId         | UUID | FK → Tag         |

**Validation**:

- Sum of `TransactionSplit.amount` for a transaction MUST equal `Transaction.amount`.
- A `transfer`-type transaction always has a `transferPairId` pointing to its counterpart
  and is excluded from income/expense aggregates (FR-011).
- Duplicate check on insert (FR-020/FR-038): flag as `duplicateOfId` when an existing,
  non-deleted transaction exists with the same `accountId`, the same `amount`, and a
  `date` within ±1 day.

## Budget

A planned amount for a category over a period.

| Field           | Type                      | Notes                                                                   |
| --------------- | ------------------------- | ----------------------------------------------------------------------- |
| id              | UUID                      | PK                                                                      |
| categoryId      | UUID                      | FK → Category                                                           |
| periodType      | enum: `monthly`, `yearly` |                                                                         |
| amount          | integer                   | Planned amount for one period                                           |
| rolloverEnabled | boolean                   | FR-025                                                                  |
| isSinkingFund   | boolean                   | FR-026 — accumulates across periods toward a goal rather than resetting |

### BudgetItem

The realized instance of a Budget for one concrete period (e.g., "March 2026").

| Field            | Type    | Notes                                                               |
| ---------------- | ------- | ------------------------------------------------------------------- |
| id               | UUID    | PK                                                                  |
| budgetId         | UUID    | FK → Budget                                                         |
| periodStart      | date    |                                                                     |
| periodEnd        | date    |                                                                     |
| plannedAmount    | integer | Copied from Budget at period start, plus any rollover-in            |
| actualAmount     | integer | Maintained by the budget engine from matching transactions (FR-024) |
| rolloverInAmount | integer | Unused amount carried in from the previous period, if enabled       |

## RecurringRule

A definition of a predictable future transaction.

| Field       | Type                                | Notes                          |
| ----------- | ----------------------------------- | ------------------------------ |
| id          | UUID                                | PK                             |
| accountId   | UUID                                | FK → Account                   |
| categoryId  | UUID                                | FK → Category                  |
| amount      | integer                             | Expected amount                |
| frequency   | enum: `weekly`, `monthly`, `yearly` |                                |
| dayOfPeriod | integer                             | e.g., day-of-month for monthly |
| isActive    | boolean                             |                                |

### ExpectedEvent

A specific predicted occurrence generated from a RecurringRule.

| Field                | Type                                 | Notes              |
| -------------------- | ------------------------------------ | ------------------ |
| id                   | UUID                                 | PK                 |
| recurringRuleId      | UUID                                 | FK → RecurringRule |
| expectedDate         | date                                 |                    |
| status               | enum: `pending`, `matched`, `missed` | FR-029/030/031     |
| matchedTransactionId | UUID, nullable                       | Set once matched   |

## InvestmentHolding

An asset the user owns outside of cash accounts.

| Field     | Type                | Notes                                                                  |
| --------- | ------------------- | ---------------------------------------------------------------------- |
| id        | UUID                | PK                                                                     |
| name      | string              |                                                                        |
| type      | string              | e.g., "mutual fund", "stock", "gold" (free text — not a fixed catalog) |
| costBasis | integer             | Total amount originally invested                                       |
| deletedAt | timestamp, nullable | Soft delete                                                            |

### InvestmentValuation

A point-in-time value update for a holding.

| Field     | Type    | Notes                      |
| --------- | ------- | -------------------------- |
| id        | UUID    | PK                         |
| holdingId | UUID    | FK → InvestmentHolding     |
| date      | date    |                            |
| value     | integer | Current value as of `date` |

## Liability

A debt the user owes.

| Field              | Type                        | Notes       |
| ------------------ | --------------------------- | ----------- |
| id                 | UUID                        | PK          |
| name               | string                      |             |
| type               | enum: `loan`, `credit_card` |             |
| outstandingBalance | integer                     |             |
| emiAmount          | integer, nullable           |             |
| emiDueDay          | integer 1-31, nullable      |             |
| deletedAt          | timestamp, nullable         | Soft delete |

## NetWorthSnapshot

A recorded net worth data point (FR-034's "history over time").

| Field            | Type    | Notes                                                        |
| ---------------- | ------- | ------------------------------------------------------------ |
| id               | UUID    | PK                                                           |
| date             | date    |                                                              |
| totalAssets      | integer | Sum of account balances + investment valuations as of `date` |
| totalLiabilities | integer | Sum of outstanding liability balances as of `date`           |
| netWorth         | integer | `totalAssets - totalLiabilities`                             |

## BackupRecord

Metadata about a previously created backup, kept locally for the user's reference.

| Field         | Type      | Notes                                                      |
| ------------- | --------- | ---------------------------------------------------------- |
| id            | UUID      | PK                                                         |
| createdAt     | timestamp |                                                            |
| schemaVersion | string    | Data-model version the backup was created against (FR-041) |
| sizeBytes     | integer   |                                                            |
| checksum      | string    | Integrity check value stored in the backup file itself     |

## UserProfile

The single local user's settings (singleton row).

| Field             | Type                   | Notes                                                                  |
| ----------------- | ---------------------- | ---------------------------------------------------------------------- |
| id                | literal `"local-user"` | Singleton PK                                                           |
| pinVerifierHash   | string                 | Salted hash of the PIN (FR-004) — never the PIN itself                 |
| pinSalt           | string                 |                                                                        |
| encryptionSalt    | string                 | Salt used to derive the AES key from the PIN (separate from `pinSalt`) |
| biometricEnabled  | boolean                | FR-002                                                                 |
| autoLockTimeoutMs | integer                | Default `300000` (5 minutes, FR-003)                                   |
| storagePersisted  | boolean                | Result of the `navigator.storage.persist()` request (FR-044)           |

## Entity Relationship Summary

```
Account 1---* Transaction *---* Category   (via TransactionSplit)
Transaction *---1 Merchant
Transaction *---* Tag                      (via TransactionTag)
Transaction 1---1 Transaction              (transfer pair, self-referential)
Category 1---* Category                    (parent/child)
Merchant 1---* MerchantAlias
Budget 1---* BudgetItem
Category 1---* Budget
RecurringRule 1---* ExpectedEvent
ExpectedEvent *---0..1 Transaction         (matched)
InvestmentHolding 1---* InvestmentValuation
(Account + InvestmentHolding + Liability) ---* NetWorthSnapshot   (aggregated, not FK'd)
UserProfile (singleton, unrelated to ledger data)
BackupRecord (standalone metadata log)
```
