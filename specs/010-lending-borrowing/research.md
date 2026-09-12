# Phase 0 Research: Personal Lending & Borrowing (IOU) Tracking

All items below were resolved from the existing codebase (no external research needed — this
feature composes entirely with patterns already proven in specs 001-009). Each entry follows
Decision / Rationale / Alternatives considered.

## 1. How a loan/repayment moves real money without inventing a new transaction type

**Decision**: Post loan issuance and repayments as ordinary `Transaction` rows with
`type: 'transfer'` and `transferPairId: null` (single-sided, not a paired transfer) on the one
account involved, created through the existing `TransactionEngine.recordTransaction`.

**Rationale**: `analyticsEngine.ts` already excludes every `type === 'transfer'` transaction
from income/expense totals (`analyticsEngine.ts:88`), which is exactly the treatment FR-003/
FR-005 need (a loan is neither income nor spend). A repo-wide search confirms no code path
assumes `transferPairId` is non-null for a `'transfer'`-typed row — `TransactionsPage.tsx` and
`DashboardPage.tsx` only use it for a display-label fallback (`tx.type === 'transfer' ?
'Transfer' : tx.type`), and `TransactionRepository.createTransferPair` is simply one caller
that happens to always set a pair; it is not the only legal way to write a `'transfer'` row.
Reusing the existing type avoids touching every `TransactionType`-aware switch in the app
(analytics, dashboard, transaction list, CSV/XLSX export, backup schema) for a distinction only
this feature cares about.

**Alternatives considered**:
- A new `'lending'`/`'borrowing'` `TransactionType` — rejected: ripples through every
  exhaustive `switch`/union check on `TransactionType` across the codebase for no behavioral
  gain over reusing `'transfer'`.
- `'expense'`/`'income'` type — rejected: would incorrectly count loans as real spend/income in
  every budget, analytics chart, and the year-in-review report (spec 011).

## 2. How pending/outstanding balance stays correct (never drifts)

**Decision**: `PersonLoan` and `LoanRepayment` never store a running balance. Pending balance
is always computed as `principal - Σ(non-deleted repayments) - writeOffAmount`, in a new pure
function (`computePendingBalance`), the same derivation strategy spec 003 established for
`SavingsGoal`/`GoalContribution` progress.

**Rationale**: Precedent already proven in production (spec 003's `goalProgress.ts`) and
required by FR-006 ("MUST NOT be independently stored in a way that can drift out of sync").

**Alternatives considered**: A cached `pendingBalance` column updated on every write — rejected
for the same reason spec 003 rejected it: any missed update path silently corrupts a number the
user relies on to know who owes what.

## 3. Where write-off lives

**Decision**: `writeOffAmount` (integer, smallest currency unit) and `writeOffAt` (nullable
timestamp) are fields directly on `PersonLoan`, not a synthetic `LoanRepayment` row with a
flag.

**Rationale**: FR-011 requires a write-off to never touch an account's balance, while every
ordinary `LoanRepayment` always posts a transaction (FR-005). Keeping write-off as a distinct
field means `LoanRepaymentRepository.create` never has to branch on "is this one secretly not
real money" — the branch happens once, at the point a write-off is recorded, and "settled by
repayment vs. settled by write-off" (FR-008) becomes a direct field read instead of an inferred
guess from ledger shape.

**Alternatives considered**: A `LoanRepayment.isWriteOff` boolean — rejected: pushes the
real-money-vs-not distinction into every current and future consumer of the repayment ledger
(the transaction-posting path, CSV export, any future reporting) instead of isolating it to the
one place a write-off is created.

## 4. Overdue reminders

**Decision**: Extend the existing `runNotificationCheck` orchestrator (spec 004,
`src/domain/notifications/runNotificationCheck.ts`) with a third pure candidate source,
`findOverduePersonLoans`, alongside the existing `findDueRecurringEvents` and
`findCrossedBudgetThresholds`. Candidates feed the same `NotifiedItemRepository` dedupe loop
(`key = "personLoan:<loanId>:overdue"`), so an overdue loan surfaces exactly once per overdue
state, identical to how a recurring event or budget threshold is only ever announced once.

**Rationale**: FR-013 explicitly asks to reuse the app's existing reminder mechanism rather
than add new infrastructure; the orchestrator's shape (pure candidate-finding function +
existing dedupe log) already fits a third candidate type with no structural change.

**Alternatives considered**: A separate polling/reminder path specific to loans — rejected as
pure duplication of a mechanism that already exists and already satisfies every acceptance
scenario in User Story 4.

## 5. Net worth impact

**Decision**: Extend `computeNetWorth` in `src/domain/wealth/wealthEngine.ts` — the single
function every net-worth consumer (NetWorthPage, AnalyticsPage's `netWorthTrend`, and the
year-in-review report from spec 011) already calls — to add the sum of open `'lent'` pending
balances to `totalAssets` and the sum of open `'borrowed'` pending balances to
`totalLiabilities`.

**Rationale**: `computeNetWorth` is already the one place `totalAssets`/`totalLiabilities` are
assembled (cash + investments vs. `Liability` rows); adding a third input here means every
existing and future consumer inherits correct behavior automatically, satisfying FR-014 and
SC-006 without a parallel calculation path.

**Alternatives considered**: Modeling an open "lent" loan as a synthetic `Liability`-adjacent
or `InvestmentHolding`-adjacent row — rejected: those entities carry semantics (interest rate,
minimum payment, cost basis) that don't apply and would need to be nulled out everywhere,
whereas summing `PersonLoan` directly in `computeNetWorth` needs no schema contortion.

## 6. Enforcing rules at the repository boundary, not just the UI

**Decision**: FR-007 (no overpayment), FR-018 (no zero/negative amount), and FR-015 (block
deleting a person with open loans) are all enforced inside the repository layer
(`LoanRepaymentRepository.create`, `PersonLoanRepository.create`/`writeOff`,
`PersonRepository.softDelete`), not only in page-level form validation.

**Rationale**: Matches the precedent spec 003 set for FR-009 (future-dated contribution
rejection) — enforcing at the repository boundary means the rule holds for every current and
future caller (a page, an import routine, a restore path), not just whichever form happens to
call it today.

**Alternatives considered**: UI-only validation (disable the submit button past the remaining
balance) — rejected: does not hold for any non-UI caller and the constitution's Test-First
principle (IV) expects these invariants to be independently verifiable at the domain/data
layer.

## 7. Schema versioning

**Decision**: One new additive Dexie schema version (v9) adding three tables — `people`,
`personLoans`, `personLoanRepayments` — following the exact additive-only pattern of versions
1 through 8 in `src/data/dexie/db.ts` (no edits to any prior `version()` block).

**Rationale**: Established, unbroken precedent across every prior spec (002-009); deviating
would be an unjustified Complexity Tracking item.
