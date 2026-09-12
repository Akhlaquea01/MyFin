# Phase 1 Data Model: Personal Lending & Borrowing (IOU) Tracking

Three new entities, following the existing `Timestamped`/`SoftDeletable` conventions in
`src/domain/entities.ts`. All monetary fields are integers in the smallest currency unit
(Constitution Principle VI). No changes to any existing entity except `NetWorthBreakdown`'s
computation (behavior only — see `research.md` §5), and `TrashPage.tsx`'s enumerated list of
recoverable entity types (UI change, not a schema change).

## Person

Represents a contact the user lends to or borrows from.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `ID` | UUID |
| `name` | `string` | Required, non-empty after trim |
| `notes` | `string \| null` | Optional free text |
| `createdAt`, `updatedAt` | `EpochMillis` | `Timestamped` |
| `deletedAt` | `EpochMillis \| null` | `SoftDeletable` |

**Derived (never stored)**: net outstanding position = Σ(open `'lent'` pending balances for
this person) − Σ(open `'borrowed'` pending balances for this person); computed by
`computeNetPositionForPerson` (see `contracts/loan-progress-engine.md`).

**Validation**: `name` MUST be non-empty (FR-001).

**Deletion rule (FR-015)**: `PersonRepository.softDelete` MUST throw/reject if the person has
any `PersonLoan` whose derived pending balance is greater than zero. Enforced at the repository
boundary per `research.md` §6.

## PersonLoan

A single lending or borrowing event between the user and a `Person`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `ID` | UUID |
| `personId` | `ID` | FK → `Person` |
| `direction` | `'lent' \| 'borrowed'` | Immutable after creation (see Edge Cases below) |
| `principalAmount` | `number` | Integer, smallest currency unit; MUST be > 0 (FR-018) |
| `date` | `ISODateString` | The date the principal moved |
| `dueDate` | `ISODateString \| null` | Optional |
| `notes` | `string \| null` | Optional |
| `accountId` | `ID` | FK → `Account` — the account the principal moved through |
| `transactionId` | `ID` | FK → the `Transaction` this loan posted (FR-003); never null |
| `writeOffAmount` | `number` | Integer; 0 until written off (research.md §3) |
| `writeOffAt` | `EpochMillis \| null` | Set exactly once, when written off |
| `createdAt`, `updatedAt` | `EpochMillis` | `Timestamped` |
| `deletedAt` | `EpochMillis \| null` | `SoftDeletable` |

**Derived (never stored)**:
- `pendingBalance = principalAmount - Σ(non-deleted LoanRepayment.amount for this loan) - writeOffAmount`
- `status`: `'open'` while `pendingBalance > 0`; `'settled-by-writeoff'` if `writeOffAt` is set;
  otherwise `'settled-by-repayment'` when `pendingBalance === 0`.
- `isOverdue`: `dueDate !== null && dueDate < asOfDate && pendingBalance > 0`.

**Validation**:
- `principalAmount > 0` (FR-018).
- `accountId` MUST reference an existing account (may be archived — archived accounts remain
  valid history, consistent with spec 009's precedent for archived accounts as valid targets).
- Creating a `PersonLoan` MUST atomically create its linked `Transaction` (FR-003): a `'lent'`
  loan posts a negative-amount transaction on `accountId`; a `'borrowed'` loan posts a
  positive-amount transaction, both `type: 'transfer'`, `transferPairId: null` (research.md §1).

**Edge case — direction is immutable**: changing `direction` after creation would silently
invert the sign of money already posted to the account; this feature does not expose editing
`direction`, `principalAmount`, `accountId`, or `date` after creation (only `notes`/`dueDate`
are editable). Correcting a mis-entered loan is done by deleting it (which reverses its
transaction, see below) and creating a new one.

## LoanRepayment

A single repayment logged against an open `PersonLoan`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `ID` | UUID |
| `loanId` | `ID` | FK → `PersonLoan` |
| `amount` | `number` | Integer, smallest currency unit; MUST be > 0 (FR-018) |
| `date` | `ISODateString` | |
| `accountId` | `ID` | FK → `Account` — the account the repayment moved through |
| `transactionId` | `ID` | FK → the `Transaction` this repayment posted (FR-005); never null |
| `createdAt`, `updatedAt` | `EpochMillis` | `Timestamped` |
| `deletedAt` | `EpochMillis \| null` | `SoftDeletable` |

**Validation** (enforced in `LoanRepaymentRepository.create`, research.md §6):
- `amount > 0` (FR-018).
- `amount <= computePendingBalance(loan, existingRepayments)` at creation time — an amount
  exceeding the loan's current pending balance MUST be rejected (FR-007). Rejecting the whole
  loan's target being already settled (`pendingBalance === 0`) is the same check at its
  boundary (Edge Cases: "repayment against an already-settled loan").
- Creating a `LoanRepayment` MUST atomically create its linked `Transaction` (FR-005): against
  a `'lent'` loan it posts a positive-amount transaction on `accountId` (money returning);
  against a `'borrowed'` loan it posts a negative-amount transaction (money paid back), both
  `type: 'transfer'`, `transferPairId: null`.

**Soft delete ("undo a mis-logged repayment")**: `LoanRepaymentRepository.softDelete` MUST also
soft-delete its linked `Transaction` (reusing `TransactionEngine.deleteTransaction`, which
already recalculates the account balance), so the loan's derived pending balance and the
account balance move back together. `restore` is the mirror operation.

## Relationships

```text
Person 1---* PersonLoan 1---* LoanRepayment
PersonLoan  *---1 Account   (accountId)
LoanRepayment *---1 Account (accountId)
PersonLoan  1---1 Transaction (transactionId, the principal movement)
LoanRepayment 1---1 Transaction (transactionId, the repayment movement)
```

## State transitions (PersonLoan.status, derived)

```text
        create loan
             |
             v
          [open] --- log repayment(s), sum < principal ---> [open]
             |
             |--- log repayment(s), sum == principal - writeOffAmount ---> [settled-by-repayment]
             |
             '--- write off remaining balance ---> [settled-by-writeoff]
```

`[settled-by-repayment]` and `[settled-by-writeoff]` are terminal for the purposes of new
repayments/write-offs: `LoanRepaymentRepository.create` and the write-off action both reject
being invoked against a loan whose `pendingBalance` is already `0` (Edge Cases: "repayment or
write-off against an already-settled loan").

## Dexie schema (additive v9, research.md §7)

```text
people:                 'id, deletedAt'
personLoans:            'id, personId, accountId, direction, deletedAt'
personLoanRepayments:   'id, loanId, accountId, deletedAt'
```

All three follow the existing `EncryptedRow` shape (id + `encryptedData` blob) with the above
as unencrypted, indexed structural columns only — no new plaintext-on-disk column, consistent
with every table added since v8 (Constitution Principle II).
