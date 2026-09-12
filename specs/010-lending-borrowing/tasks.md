---
description: 'Task list template for feature implementation'
---

# Tasks: Personal Lending & Borrowing (IOU) Tracking

**Input**: Design documents from `/specs/010-lending-borrowing/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/loan-progress-engine.md](contracts/loan-progress-engine.md),
[quickstart.md](quickstart.md)

**Tests**: Included. `src/domain/personLoans/` isn't one of Constitution Principle IV's four
named engines, but per the precedent already set for specs 002/003/006/007/009 (plan.md's
Constitution Check), it is held to the same test-first bar since it directly drives account
balances and net worth — the pure engine, the three new repositories, and the notification
extension all get tests before being considered done.

**Organization**: Tasks are grouped by user story (spec.md priorities P1-P5). Each story
extends the same `PeoplePage.tsx`/`personLoanRepository.ts` pair introduced in Foundational:
US1 adds recording a loan, US2 adds repayments, US3 adds the People list's net-position view
and the Dashboard tile, US4 adds overdue reminders, US5 adds write-off. Each layer is
additive and independently testable/shippable without the layers after it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1-US5)
- File paths below are real paths in this repository, following the conventions already
  established by `src/domain/savingsGoals/` (pure engine), `src/data/dexie/savingsGoalRepository.ts`
  (repository pair pattern), and `src/domain/notifications/runNotificationCheck.ts` (candidate
  orchestrator).

---

## Phase 1: Setup

**Purpose**: Establish a clean baseline before touching any code

- [X] T001 Confirm no new npm dependency is required (plan.md's Technical Context — reuses the
      existing stack only) and run `npm run test:unit -- --run` to confirm the suite passes
      cleanly before starting, establishing a baseline to diff against.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared entities, schema, pure engine, and repositories every user story
depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Add `Person`, `PersonLoan`, and `LoanRepayment` interfaces to
      `src/domain/entities.ts` exactly per [data-model.md](data-model.md)'s field tables
      (integer monetary fields, `Timestamped`/`SoftDeletable` where noted, `transactionId`
      non-null on both `PersonLoan` and `LoanRepayment`).
- [X] T003 In `src/data/dexie/db.ts`: add `PersonRow`, `PersonLoanRow`, `PersonLoanRepaymentRow`
      (each extending `EncryptedRow`, structural columns per data-model.md's "Dexie schema"
      section), their `EntityTable` field declarations on `MyFinDatabase`, and a new
      `this.version(9).stores({ people: 'id, deletedAt', personLoans: 'id, personId,
      accountId, direction, deletedAt', personLoanRepayments: 'id, loanId, accountId,
      deletedAt' })` block appended after the existing v8 block — additive only, no edits to
      any prior `version()` call (research.md §7).
- [X] T004 [P] Create `src/domain/personLoans/types.ts` with the `LoanStatus` union
      (`'open' | 'settled-by-repayment' | 'settled-by-writeoff'`) and the input/output types
      named in [contracts/loan-progress-engine.md](contracts/loan-progress-engine.md)
      (`ComputePendingBalanceInput`, `ComputeNetPositionInput`, etc.).
- [X] T005 [P] Create `src/domain/personLoans/loanProgress.ts` implementing
      `computePendingBalance`, `deriveLoanStatus`, `isLoanOverdue`,
      `computeNetPositionForPerson`, `computeOpenLoanTotals`, `validateRepaymentAmount`, and
      `validateWriteOffAmount`, each exactly per its contract in
      [contracts/loan-progress-engine.md](contracts/loan-progress-engine.md) (pure, no I/O).
      Depends on T004. (`findOverduePersonLoans` is added later, in US4 — T017.)
- [X] T006 [P] Create `tests/unit/loanProgressEngine.test.ts` with hand-computed cases for
      every function in T005: pending balance with zero/partial/full repayments and a
      write-off; status transitions; overdue true/false around the due date boundary; net
      position mixing lent+borrowed for one person; open totals across several people;
      `validateRepaymentAmount` rejecting zero, negative, over-balance, and already-settled
      amounts; `validateWriteOffAmount` rejecting an already-settled loan. Depends on T005.
- [X] T007 Create `src/data/dexie/personLoanRepository.ts` with three exports per
      [contracts/loan-progress-engine.md](contracts/loan-progress-engine.md)'s "Repository
      interfaces consumed" section:
      - `PersonRepository`: `create`, `list` (non-deleted), `getById`, `softDelete` (loads the
        person's loans via `PersonLoanRepository.listForPerson`, computes each
        `pendingBalance` via `computePendingBalance`, and throws if any is `> 0` — FR-015),
        `restore`.
      - `PersonLoanRepository`: `create` (rejects `principalAmount <= 0`; posts the linked
        `Transaction` via `TransactionEngine.recordTransaction` with `type: 'transfer'`,
        `transferPairId: null`, a negative amount for `'lent'` / positive for `'borrowed'`,
        and a generated note like `Lent to <personName>` / `Borrowed from <personName>` —
        research.md §1; stores the returned transaction's id as `transactionId`),
        `listForPerson`, `listAllOpen` (every non-deleted loan across all people, for the
        Dashboard tile and notifications), `update` (only `notes`/`dueDate` — data-model.md's
        immutability note), `writeOff` (calls `validateWriteOffAmount` first; sets
        `writeOffAmount`/`writeOffAt`; creates no transaction), `softDelete`, `restore`.
      - `LoanRepaymentRepository`: `create` (calls `validateRepaymentAmount` first against the
        loan's current pending balance; posts the linked `Transaction` — positive amount
        against a `'lent'` loan, negative against `'borrowed'`), `listForLoan`, `softDelete`
        (also calls `TransactionEngine.deleteTransaction` on the linked transaction so the
        account balance reverts), `restore` (mirror, via `TransactionEngine.restoreTransaction`).
      Depends on T002, T003, T005.
- [X] T008 [P] Create `tests/integration/personLoanRepositories.test.ts` covering: a `'lent'`
      loan decreases its account's balance and a `'borrowed'` loan increases it (and their
      repayments move the balance back the opposite way); `PersonLoanRepository.create`/
      `LoanRepaymentRepository.create` reject non-positive amounts (FR-018);
      `LoanRepaymentRepository.create` rejects an amount exceeding the remaining balance and
      rejects any amount against an already-settled loan (FR-007); `PersonRepository.softDelete`
      throws when the person has an open loan and succeeds once none remain (FR-015);
      soft-deleting a `LoanRepayment` restores the account balance and the loan's pending
      balance to their prior state, and `restore` reverses that (data-model.md). Depends on T007.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Record money lent or borrowed (Priority: P1) 🎯 MVP

**Goal**: A user can record a loan (lent or borrowed) against a person and an account, and the
account balance moves accordingly.

**Independent Test**: quickstart.md Scenario 1 — record a "lent" and a "borrowed" loan and
verify both the affected account balances and the new open loans.

### Tests for User Story 1 ⚠️

> Write these tests FIRST, ensure they FAIL before implementation

- [X] T009 [P] [US1] Create `tests/e2e/personLending.spec.ts` with a scenario that opens the
      new People page, records a "lent" loan to a new person against an existing account, and
      a "borrowed" loan from a second new person, then asserts both the account's displayed
      balance and each person's listed outstanding amount (quickstart.md Scenario 1).

### Implementation for User Story 1

- [X] T010 [US1] Create `src/pages/PeoplePage.tsx`: a people list (name only, for now) and a
      "Record a loan" dialog with person selection-or-inline-creation (calling
      `PersonRepository.create` when a typed name doesn't match an existing person), direction
      (lent/borrowed), principal amount, account `<Select>`, date, optional due date, and
      optional notes, submitting via `PersonLoanRepository.create`. Follows the existing
      dialog/form conventions in `SavingsGoalsPage.tsx`. Depends on T007.
- [X] T011 [US1] In `src/App.tsx`, add `<Route path="people" element={<PeoplePage />} />` and
      the corresponding navigation entry, following the existing route list's conventions.
      Depends on T010.

**Checkpoint**: User Story 1 is fully functional and independently testable — a user can
record loans and see account balances move.

---

## Phase 4: User Story 2 - Log a partial or full repayment (Priority: P2)

**Goal**: A user can log a repayment (partial or full) against an open loan; the pending
balance updates and the loan settles once it reaches zero.

**Independent Test**: quickstart.md Scenario 2 — partial repayment, a rejected overpayment,
then an exact settling repayment, then a rejected repayment against the now-settled loan.

### Tests for User Story 2 ⚠️

- [X] T012 [P] [US2] Extend `tests/e2e/personLending.spec.ts`: log a partial repayment against
      the "lent" loan from US1 and verify the account balance and the loan's shown pending
      balance both update; attempt an overpayment and verify it's rejected with an explanation
      and nothing changes; log the exact remaining amount and verify the loan shows settled;
      attempt one more repayment and verify it's rejected (quickstart.md Scenario 2).

### Implementation for User Story 2

- [X] T013 [US2] Extend `PeoplePage.tsx` with a per-person expandable loan history (mirroring
      `SavingsGoalsPage.tsx`'s per-goal detail pattern) showing each loan's principal, pending
      balance (via `computePendingBalance`), and status (via `deriveLoanStatus`), plus a "Log
      repayment" form calling `LoanRepaymentRepository.create` and surfacing its rejection
      message inline when `validateRepaymentAmount` fails. Depends on T010.

**Checkpoint**: User Stories 1 and 2 both work independently — loans can be recorded and paid
down or fully settled.

---

## Phase 5: User Story 3 - See who owes what at a glance (Priority: P3)

**Goal**: The People list shows each person's net outstanding position and flags overdue
balances; the Dashboard shows a combined "you're owed / you owe" total.

**Independent Test**: quickstart.md Scenario 3 — a settled loan, an open "borrowed" loan, and
an overdue "lent" loan across three people, verified in both the People list and the
Dashboard tile.

### Tests for User Story 3 ⚠️

- [X] T014 [P] [US3] Extend `tests/e2e/personLending.spec.ts`: with a settled loan (Asha, from
      US2), an open borrowed loan (Rohit, from US1), and a new overdue lent loan (Meera, due
      date yesterday), verify the People list shows Meera's balance flagged overdue, Rohit's
      "you owe" balance, and Asha absent from outstanding totals; verify the Dashboard tile
      shows the correct combined totals (quickstart.md Scenario 3).

### Implementation for User Story 3

- [X] T015 [US3] Extend `PeoplePage.tsx`'s list rendering to show each person's net position
      via `computeNetPositionForPerson` (fed that person's loans with pre-computed
      `pendingBalance`s) and an overdue badge when `isLoanOverdue` is true for any of their
      open loans; exclude people with a zero net position and no overdue loans from any
      "outstanding" emphasis (FR-009). Depends on T010, T005.
- [X] T016 [US3] Add a summary card to `src/pages/DashboardPage.tsx` reading
      `PersonLoanRepository.listAllOpen`, computing each loan's `pendingBalance`, and passing
      the results to `computeOpenLoanTotals` to show "You're owed ₹X" / "You owe ₹Y"
      (FR-010). Depends on T007, T005.

**Checkpoint**: User Stories 1-3 all work independently — full visibility into who owes what.

---

## Phase 6: User Story 4 - Get reminded about overdue loans (Priority: P4)

**Goal**: An overdue open loan surfaces exactly one reminder, reusing the app's existing
notification mechanism.

**Independent Test**: quickstart.md Scenario 4 — an overdue loan triggers a reminder on next
app open, the same reminder does not repeat on a subsequent open, and settling the loan stops
further reminders.

### Tests for User Story 4 ⚠️

- [X] T017 [P] [US4] Add `findOverduePersonLoans` to `src/domain/personLoans/loanProgress.ts`
      exactly per its contract (uses `isLoanOverdue`; returns one `NotificationCandidate` per
      overdue loan, `key: "personLoan:<loanId>:overdue"`), and add unit tests for it to
      `tests/unit/loanProgressEngine.test.ts`: an overdue lent loan, an overdue borrowed loan,
      a loan with a future due date (no candidate), and a loan with no due date (no
      candidate). Depends on T005.
- [X] T018 [P] [US4] Add integration coverage (new test or extending
      `tests/integration/personLoanRepositories.test.ts`) that runs `runNotificationCheck`
      with an overdue open loan and asserts: a candidate is dispatched and logged via
      `NotifiedItemRepository`; a second run with no change dispatches nothing further;
      settling the loan (full repayment) before a third run also dispatches nothing further
      (quickstart.md Scenario 4). Depends on T019.

### Implementation for User Story 4

- [X] T019 [US4] Extend `src/domain/notifications/runNotificationCheck.ts`: fetch
      `PersonLoanRepository.listAllOpen` and their people's names, compute each loan's
      `pendingBalance`, build `findOverduePersonLoans` inputs, and merge its candidates into
      the existing `[...recurringCandidates, ...budgetCandidates]` array feeding the shared
      `NotifiedItemRepository` dedupe loop (research.md §4) — no change to that loop's logic.
      Depends on T017, T007.

**Checkpoint**: User Stories 1-4 all work independently — overdue loans are proactively
surfaced.

---

## Phase 7: User Story 5 - Write off a loan (Priority: P5)

**Goal**: A user can write off an open loan's remaining balance without moving any money,
excluding it from outstanding totals while keeping its history visible.

**Independent Test**: quickstart.md Scenario 5 — write off an open loan, verify the linked
account's balance is unchanged, the loan shows settled-by-write-off, and it disappears from
outstanding totals while remaining visible in history.

### Tests for User Story 5 ⚠️

- [X] T020 [P] [US5] Extend `tests/e2e/personLending.spec.ts`: record a new loan, note the
      account balance, write it off, verify the balance is unchanged and the loan shows
      settled-by-write-off, then verify it still appears (with its write-off) in that person's
      history and is excluded from the People list/Dashboard outstanding totals
      (quickstart.md Scenario 5).

### Implementation for User Story 5

- [X] T021 [US5] Add a "Write off" action to `PeoplePage.tsx`'s loan detail (T013), calling
      `PersonLoanRepository.writeOff` (implemented in T007) and rendering the
      settled-by-write-off status distinctly from settled-by-repayment via `deriveLoanStatus`.
      Depends on T013, T007.

**Checkpoint**: All five user stories are independently functional — the feature matches
spec.md in full.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Requirements that span every story (FR-014, FR-015's UI surface, FR-016) plus
final validation

- [X] T022 [P] Extend `computeNetWorth` in `src/domain/wealth/wealthEngine.ts` to add
      `computeOpenLoanTotals`'s `totalLent` to `totalAssets` and `totalBorrowed` to
      `totalLiabilities` (FR-014, research.md §5). Depends on T005, T007.
- [X] T023 [P] Add unit/integration coverage for T022: net worth is unchanged immediately
      after recording a "lent" or "borrowed" loan (the receivable/payable offsets the cash
      move) and decreases by the written-off amount once that loan is written off
      (quickstart.md Scenario 8). Depends on T022.
- [X] T024 [P] Add deleted People/PersonLoans/LoanRepayments sections to
      `src/pages/TrashPage.tsx`, mirroring its existing Accounts/Transactions/Goals/Rules
      sections (query each `db.*` table filtered by `deletedAt`, decrypt, list with a Restore
      button calling the corresponding repository's `restore`) (FR-016). Depends on T007.
- [X] T025 Wire the FR-015 rejection message from `PersonRepository.softDelete` into
      `PeoplePage.tsx`'s delete-person action so the user sees why deletion was blocked, and
      add the corresponding case to `tests/e2e/personLending.spec.ts` (quickstart.md Scenario
      6). Depends on T010, T007.
- [X] T026 [P] Add the repayment-undo case to `tests/e2e/personLending.spec.ts` (or
      `TrashPage.tsx`'s own test coverage, if one exists): soft-delete a logged repayment from
      Trash and verify the account balance and the loan's pending balance both revert
      (quickstart.md Scenario 7). Depends on T024.
- [X] T027 Run `npm run test:unit -- --run`, `npm run test:e2e`, and `npm run lint`/`npm run
      check` for the full suite; walk through every scenario in
      [quickstart.md](quickstart.md) manually as a final sanity pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS every user story.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational + US1 (extends `PeoplePage.tsx`'s dialog
  and reuses the loan created there in tests, though its own repository logic is independent).
- **User Story 3 (Phase 5)**: Depends on Foundational + US1/US2 (needs loans in varied states
  to show a meaningful list/tile).
- **User Story 4 (Phase 6)**: Depends on Foundational + US1 (needs an overdue loan to exist).
- **User Story 5 (Phase 7)**: Depends on Foundational + US1.
- **Polish (Phase 8)**: Depends on all five user stories being complete.

Unlike a fully parallel-team feature, US2-US5 each extend the same `PeoplePage.tsx` UI file
US1 creates, so in practice they are best implemented sequentially in priority order even
though their underlying repository logic (T007) is already complete after Foundational.

### Parallel Opportunities

- T004-T006 (engine types, engine implementation, engine unit tests) are sequential
  (each depends on the previous), but T008 (repository integration tests) can be written
  alongside T006 once T007 lands.
- Within each user story phase, the `[P]`-marked test-authoring task can be written before
  (or alongside) its implementation task, per the "write tests first" convention.
- T022 (net worth) and T024 (Trash) in Phase 8 touch different files and can run in parallel
  once T005/T007 exist.

---

## Parallel Example: Foundational Phase

```bash
# After T002/T003 (entities + schema) land:
Task: "Create src/domain/personLoans/types.ts"
# Then, once T004 lands:
Task: "Create src/domain/personLoans/loanProgress.ts"
Task: "Create tests/unit/loanProgressEngine.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (schema, entities, engine, repositories — CRITICAL, blocks
   everything)
3. Complete Phase 3: User Story 1 — a user can record a loan and see it move an account
   balance
4. **STOP and VALIDATE**: run quickstart.md Scenario 1 manually
5. Demo if ready — this alone replaces "an uncategorized transaction and a mental note"

### Incremental Delivery

1. Setup + Foundational → schema/engine/repositories ready
2. + US1 → record loans (MVP)
3. + US2 → partial repayments, settling
4. + US3 → People list net positions, overdue flags, Dashboard tile
5. + US4 → overdue reminders
6. + US5 → write-off
7. + Polish → net worth correctness, Trash, blocked-deletion UX, full quickstart pass

---

## Notes

- `[P]` tasks = different files, no dependency on an incomplete task
- `[Story]` label maps each task to its user story for traceability
- Every monetary field introduced by this feature is an integer in the smallest currency unit
  (Constitution Principle VI) — verify this in code review for T002, T005, T007
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently before moving to the next
