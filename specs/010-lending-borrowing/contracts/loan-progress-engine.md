# Contract: Personal Loan Progress Engine

This app has no external API; its "contracts" are the internal interfaces between the
domain engine (`src/domain/personLoans/`) and its callers (the repository layer, UI, and unit
tests), per Constitution Principle III's one-way dependency rule.

## `computePendingBalance(input): number`

**Input**:

```ts
interface ComputePendingBalanceInput {
	principalAmount: number; // integer, smallest currency unit, > 0
	writeOffAmount: number; // integer, 0 if not written off
	repayments: { amount: number }[]; // already scoped to this loan, non-deleted only
}
```

**Behavior**: Returns `principalAmount - Σ(repayments[].amount) - writeOffAmount`. Pure —
MUST NOT mutate input or perform I/O. Never returns a negative number in practice because
every write path that could drive it negative (an oversized repayment, a write-off exceeding
the remaining balance) is rejected before being persisted (see `validateRepaymentAmount` and
`validateWriteOffAmount` below) — but the function itself performs no clamping, so a caller
that skips validation would see the true (possibly negative) arithmetic result rather than a
silently corrected one.

**Output**: integer, smallest currency unit.

## `deriveLoanStatus(input): 'open' | 'settled-by-repayment' | 'settled-by-writeoff'`

**Input**: `{ pendingBalance: number; writeOffAt: number | null }`

**Behavior**:
1. `pendingBalance > 0` → `'open'`.
2. `pendingBalance === 0 && writeOffAt !== null` → `'settled-by-writeoff'`.
3. `pendingBalance === 0 && writeOffAt === null` → `'settled-by-repayment'`.

Pure. No error cases — every combination is covered.

## `isLoanOverdue(input, asOfDate): boolean`

**Input**: `{ dueDate: string | null; pendingBalance: number }`, plus `asOfDate: Date` (a
parameter for testability, matching the existing convention in
`src/domain/notifications/notificationEngine.ts`).

**Behavior**: `true` iff `dueDate !== null && dueDate < asOfDate (as ISO date) &&
pendingBalance > 0`. Pure.

## `computeNetPositionForPerson(input): number`

**Input**:

```ts
interface ComputeNetPositionInput {
	loans: {
		direction: 'lent' | 'borrowed';
		pendingBalance: number; // pre-computed via computePendingBalance
	}[]; // already scoped to one person
}
```

**Behavior**: Returns `Σ(pendingBalance where direction === 'lent') -
Σ(pendingBalance where direction === 'borrowed')`. Only loans with `pendingBalance > 0`
meaningfully contribute (a settled loan's `pendingBalance` is already `0`, so it naturally
contributes nothing — no separate filtering needed). Pure.

## `computeOpenLoanTotals(input): { totalLent: number; totalBorrowed: number }`

**Input**: `{ loans: { direction: 'lent' | 'borrowed'; pendingBalance: number }[] }` — every
open `PersonLoan` across all people.

**Behavior**: `totalLent` = Σ(`pendingBalance` where `direction === 'lent'`); `totalBorrowed`
= Σ(`pendingBalance` where `direction === 'borrowed'`). Consumed by:
- The Dashboard summary tile (FR-010): `totalLent` = "you're owed", `totalBorrowed` = "you owe".
- `wealthEngine.computeNetWorth` (research.md §5): `totalLent` is added to `totalAssets`,
  `totalBorrowed` is added to `totalLiabilities`.

Pure.

## `validateRepaymentAmount(input): { ok: true } | { ok: false; message: string }`

**Input**: `{ amount: number; pendingBalance: number }`

**Behavior**:
1. `amount <= 0` → `{ ok: false, message: 'Repayment amount must be greater than zero.' }`
   (FR-018).
2. `pendingBalance === 0` → `{ ok: false, message: 'This loan is already settled.' }` (Edge
   Case: repayment against an already-settled loan).
3. `amount > pendingBalance` → `{ ok: false, message: 'Repayment cannot exceed the remaining
   balance of <pendingBalance>.' }` (FR-007).
4. Otherwise `{ ok: true }`.

Pure. Called by `LoanRepaymentRepository.create` before any transaction/repayment row is
written (research.md §6) — never bypassable from the UI layer alone.

## `validateWriteOffAmount(input): { ok: true } | { ok: false; message: string }`

**Input**: `{ pendingBalance: number }` (a write-off always targets the full remaining
balance — there is no partial write-off in this feature's scope).

**Behavior**: `pendingBalance === 0` → `{ ok: false, message: 'This loan is already
settled.' }`; otherwise `{ ok: true }`. Pure.

## `findOverduePersonLoans(input, asOfDate): NotificationCandidate[]`

**Input**:

```ts
interface OverdueLoanInput {
	id: string; // PersonLoan id
	personName: string;
	direction: 'lent' | 'borrowed';
	dueDate: string | null;
	pendingBalance: number;
}
```

**Behavior**: For every input where `isLoanOverdue(...)` is `true`, returns one
`NotificationCandidate` shaped like the existing ones in `notificationEngine.ts`:

```ts
{
  kind: 'personLoan',
  key: `personLoan:${id}:overdue`,
  title: direction === 'lent' ? `Overdue: ${personName} owes you` : `Overdue: you owe ${personName}`,
  body: `Due ${dueDate}`
}
```

Pure — plugs into `runNotificationCheck` (research.md §4) exactly like the existing
`findDueRecurringEvents`/`findCrossedBudgetThresholds`, including reuse of
`NotifiedItemRepository` for one-time-per-state dedupe via `key`.

## Repository interfaces consumed (read-only by the engine; read-write by the UI)

- `PersonRepository`:
  - `create(key, input: { name; notes }): Person`
  - `update(key, id, changes: Partial<{ name; notes }>): Person`
  - `softDelete(key, id): void` — MUST throw if any of the person's loans has
    `pendingBalance > 0` (FR-015).
  - `restore(key, id): void`
  - `list(key): Person[]` — non-deleted only
- `PersonLoanRepository`:
  - `create(key, input: { personId; direction; principalAmount; date; dueDate; notes;
    accountId }): PersonLoan` — MUST reject `principalAmount <= 0` (FR-018); atomically posts
    the linked `Transaction` (data-model.md).
  - `writeOff(key, id): PersonLoan` — MUST call `validateWriteOffAmount` first; sets
    `writeOffAmount = pendingBalance`, `writeOffAt = now`; creates no `Transaction` (FR-011).
  - `update(key, id, changes: Partial<{ notes; dueDate }>): PersonLoan` — only these two
    fields are editable post-creation (data-model.md "direction is immutable").
  - `softDelete(key, id): void` / `restore(key, id): void`
  - `listForPerson(key, personId): PersonLoan[]` / `listAllOpen(key): PersonLoan[]`
- `LoanRepaymentRepository`:
  - `create(key, input: { loanId; amount; date; accountId }): LoanRepayment` — MUST call
    `validateRepaymentAmount` first; atomically posts the linked `Transaction`.
  - `softDelete(key, id): void` — MUST also soft-delete the linked `Transaction` via
    `TransactionEngine.deleteTransaction` (data-model.md).
  - `restore(key, id): void` — mirror of `softDelete`.
  - `listForLoan(key, loanId): LoanRepayment[]`

**Error cases**: `create`/`writeOff` calls reject (throw, surfaced to the UI as a form error)
exactly when the corresponding `validate*` function returns `{ ok: false }`, or when a
referenced `personId`/`accountId`/`loanId` does not resolve to an existing, non-deleted
record.
