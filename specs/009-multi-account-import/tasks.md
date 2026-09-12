---
description: 'Task list template for feature implementation'
---

# Tasks: Multi-Account Transaction Import

**Input**: Design documents from `/specs/009-multi-account-import/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md),
[contracts/import-account-resolution.md](contracts/import-account-resolution.md),
[quickstart.md](quickstart.md)

**Tests**: Included. `importService.ts` isn't one of Constitution Principle IV's four named
engines, but per the precedent already set for specs 002-004/006 (plan.md's Constitution
Check), account resolution is held to the same test-first bar since a misrouted import
silently distorts two account balances — the new pure helpers and `importRows()`'s
multi-account behavior get unit tests before being considered done.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3). All three
stories extend the same `importRows()`/`ImportPage.tsx` pair: US1 adds the core per-row
routing (with the minimal skip-and-report a resolver failure requires), US2 adds the
before-you-commit safety net (preview visibility and the whole-import collision block), and
US3 adds the after-the-fact per-account summary. Each layer is additive and independently
testable/shippable without the layers after it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths below are real paths in this repository, following the conventions already
  established in `src/data/io/importService.ts` (pure helpers + one impure orchestrator) and
  `src/pages/ImportPage.tsx` (existing optional-column selector pattern).

---

## Phase 1: Setup

**Purpose**: Establish a clean baseline before touching any code

- [X] T001 Confirm no new npm dependency is required (plan.md's Technical Context — reuses
      the existing stack only) and run `npm run test:unit -- --run` to confirm the suite
      passes cleanly before starting, establishing a baseline to diff against.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared plumbing every user story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Add `accountColumn?: string` to the `ColumnMapping` interface in
      `src/data/io/importService.ts` per [data-model.md](data-model.md). No other field
      changes yet.
- [X] T003 [P] Add a pure `resolveAccountForRow(value: string, accounts: Account[]): Account |
      null` function to `src/data/io/importService.ts` per
      [contracts/import-account-resolution.md](contracts/import-account-resolution.md): trims
      `value`, returns `null` if empty; otherwise finds the account in `accounts` whose `name`
      (trimmed) equals `value` case-insensitively, or `null` if none match. Considers every
      account passed in, including archived ones — it does not filter `accounts` itself
      (FR-003). Import the existing `Account` type from `src/domain/entities.ts`.
- [X] T004 In `src/pages/ImportPage.tsx`: change the account-fetching `useEffect` from
      `AccountRepository.list(key, false)` to `AccountRepository.list(key, true)` (include
      archived — research.md §2), and derive `const activeAccounts = accounts.filter((a) =>
      !a.isArchived)`. Replace the existing fallback "Account" `<Select>`'s `accounts.map(...)`
      with `activeAccounts.map(...)` so that dropdown's behavior is unchanged; keep the full
      `accounts` state available for later tasks.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Import One File Covering Several Accounts (Priority: P1) 🎯 MVP

**Goal**: A file with a mapped account column routes each row to the account named in that
row; a file with no account column mapped behaves exactly as it does today.

**Independent Test**: Import a file with rows for three different existing accounts (each
row carrying an account name), and verify every transaction lands in the correct account with
no manual splitting (quickstart.md Scenario 1); import a file with no account column and
verify unchanged single-account behavior (quickstart.md Scenario 2).

### Tests for User Story 1 ⚠️

> Write these tests FIRST, ensure they FAIL before implementation

- [X] T005 [P] [US1] In `tests/unit/importService.test.ts`, add unit tests for
      `resolveAccountForRow`: matches ignoring case and surrounding whitespace; returns `null`
      for a blank/whitespace-only value; returns `null` when no account matches; matches an
      archived account exactly like an active one (create one via `AccountRepository.create`
      then `AccountRepository.update(key, id, { isArchived: true })` in the test setup).
- [X] T006 [P] [US1] In `tests/unit/importService.test.ts`, add a test that calls `importRows`
      with `mapping.accountColumn` set and rows referencing two different existing accounts by
      name (mixed case/whitespace), and asserts each created transaction's `accountId` matches
      the row's named account (query via `TransactionRepository.search(key, { accountId })`
      for each account); add a second test confirming a mapping with no `accountColumn` still
      imports every row to `mapping.accountId` exactly as before (backward compatibility).

### Implementation for User Story 1

- [X] T007 [US1] In `importRows()` (`src/data/io/importService.ts`): accept a new optional 4th
      parameter `accounts: Account[] = []`. When `mapping.accountColumn` is set, resolve each
      row's destination account via `resolveAccountForRow(row[mapping.accountColumn],
      accounts)` instead of always using `mapping.accountId`. A blank value pushes `{
      rowNumber, reason: 'Account column is empty.' }` to `skippedMalformedRows` and skips the
      row; a non-blank value with no match pushes `` { rowNumber, reason: `Account "${value}"
      not found.` } `` and skips the row (FR-004). When `mapping.accountColumn` is not set,
      behavior is unchanged (`mapping.accountId` for every row). Depends on T002, T003.
- [X] T008 [US1] In `importRows()`, replace the single duplicate-detection index (currently
      built once from `TransactionRepository.search(key, { accountId: mapping.accountId })`)
      with a `Map<string, Map<string, string>>` keyed by resolved account id, built lazily the
      first time a row resolves to a given account (research.md §4); route each row's
      duplicate lookup/insert through its own resolved account's map. Replace the single
      end-of-import `TransactionEngine.recalculateAccountBalance(key, mapping.accountId)` call
      with one call per distinct account id that received at least one created transaction
      (research.md §5). Depends on T007.
- [X] T009 [US1] In `src/pages/ImportPage.tsx`: add an "Account column (optional)" `<Select>`
      (mirrors the existing optional "Description column" selector — options are `NONE` plus
      `parsed.headers`), track it in component state, include it as `accountColumn` on the
      `ColumnMapping` built in `handleImport` (`undefined` when `NONE`), and pass the fetched
      `accounts` array as `importRows`'s new 4th argument. Depends on T004, T007.

**Checkpoint**: User Story 1 is fully functional and independently testable — multi-account
files route correctly, single-account files are unchanged.

---

## Phase 4: User Story 2 - Catch Misrouted or Unmatched Accounts Before Importing (Priority: P2)

**Goal**: Before any transaction is created, the user can see which account each row will go
to, unresolvable rows are visibly flagged and excluded (not silently dropped), and an account
name that matches more than one existing account blocks the entire import.

**Independent Test**: Import a file with one blank and one typo'd account value and verify
both are flagged in the preview and reported (not silently imported or silently dropped) while
other rows still import (quickstart.md Scenario 3); create two accounts with the same name,
reference that name in a file, and verify the whole import is blocked with zero transactions
created (quickstart.md Scenario 5).

### Tests for User Story 2 ⚠️

> Write these tests FIRST, ensure they FAIL before implementation

- [X] T010 [P] [US2] In `tests/unit/importService.test.ts`, add unit tests for
      `findAccountNameCollisions`: returns `[]` when every distinct value matches at most one
      account; returns the colliding value when two accounts share a name (create both via
      `AccountRepository.create` with the same `name`); never reports a value that matches
      zero accounts as a collision; deduplicates repeated colliding values.
- [X] T011 [P] [US2] In `tests/unit/importService.test.ts`, add a test asserting `importRows`
      throws (with a message naming the colliding account) before creating any transaction
      when two accounts share a name referenced by the file's account column — assert
      `TransactionRepository.search` for both colliding accounts returns zero rows afterward,
      and that unrelated rows in the same file were also not imported. Assert the exact
      `skippedMalformedRows` reason strings from T007 (`'Account column is empty.'` and ``
      `Account "${value}" not found.` ``) for a blank and an unresolved value respectively.
- [X] T012 [US2] Add a pure `findAccountNameCollisions(values: string[], accounts: Account[]):
      string[]` function to `src/data/io/importService.ts` per
      [contracts/import-account-resolution.md](contracts/import-account-resolution.md): for
      each distinct, non-blank, trimmed value in `values`, case-insensitively counts matching
      accounts in `accounts`, returning the (deduplicated, first-seen-order) subset that match
      more than one. Depends on T003 (shares matching semantics).
- [X] T013 [US2] In `importRows()`, add a pre-pass that runs before the row loop whenever
      `mapping.accountColumn` is set: collect the distinct non-blank trimmed values of
      `row[mapping.accountColumn]` across all `rows`, call `findAccountNameCollisions`, and if
      it returns any names, throw an `Error` naming them (e.g. `` `Account name "${name}"
      matches more than one account. Rename one of them and try again.` ``) before any
      transaction is created (FR-006) — mirror the existing `MAX_IMPORT_ROWS` pre-check's
      placement and style. Depends on T007, T012.
- [X] T014 [US2] In `src/pages/ImportPage.tsx`: when an account column is selected, add a
      resolved-account column to the preview table showing, per row,
      `resolveAccountForRow(row[accountColumn], accounts)`'s matched account name or a clear
      "not found"/"empty" indicator (FR-005); separately, compute
      `findAccountNameCollisions` over the full parsed rows' account-column values and
      `accounts` whenever the account column or file changes — when it returns any names,
      disable the Import button and show which account name is ambiguous and why, using the
      same message wording as T013. Depends on T009, T012.

**Checkpoint**: User Stories 1 and 2 both work independently — routing is correct, and
mistakes are caught or blocked before anything is committed.

---

## Phase 5: User Story 3 - See Results Broken Down by Account (Priority: P3)

**Goal**: After a multi-account import completes, the result shows how many transactions were
created per account; a single-account import's result is unchanged.

**Independent Test**: Complete a multi-account import and verify the result lists a
transaction count per account matching the source file (quickstart.md Scenario 1's final
step); complete a single-account import (no account column) and verify the result summary is
identical to today's (quickstart.md Scenario 2).

### Tests for User Story 3 ⚠️

> Write these tests FIRST, ensure they FAIL before implementation

- [X] T015 [P] [US3] In `tests/unit/importService.test.ts`, add a test asserting that after an
      `importRows` call with `mapping.accountColumn` set and rows for two different accounts,
      `result.perAccountSummary` has one entry per account with the correct `count` and
      `accountName`; add a second test asserting `result.perAccountSummary` is `undefined`
      when `mapping.accountColumn` is not set.

### Implementation for User Story 3

- [X] T016 [US3] Add `perAccountSummary?: Record<string, { count: number; accountName: string
      }>` to the `ImportResult` interface in `src/data/io/importService.ts`, and populate it
      inside `importRows()` using the per-account map already built in T008 — increment a
      count and record the account's name the first time each account id is seen with a
      created transaction; leave it `undefined` when `mapping.accountColumn` is not set.
      Depends on T008, T015.
- [X] T017 [US3] In `src/pages/ImportPage.tsx`'s result card, render a per-account breakdown
      (iterate `Object.entries(result.perAccountSummary)`, e.g. "Imported 2 to Checking, 3 to
      Savings") when `result.perAccountSummary` is present and has more than one entry; leave
      the existing single-line "Created N unreviewed transaction(s)" summary as the only
      output otherwise. Depends on T016.

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T018 [P] Write E2E test `tests/e2e/multiAccountImport.spec.ts` covering
      [quickstart.md](quickstart.md) Scenarios 1, 2, 3, and 5 end-to-end through the actual
      Import page UI (multi-account happy path with per-account result breakdown,
      backward-compatible single-account import, flagged/skipped unresolved rows, and a
      collision blocking the whole import).
- [X] T019 Review all new code against Constitution Principle III (`ImportPage.tsx` still
      calls only `importService.ts` and `AccountRepository`, never Dexie directly) and
      Principle IV (unit tests for `resolveAccountForRow`, `findAccountNameCollisions`, and
      `importRows()`'s multi-account/collision/per-account-summary behavior all exist and
      pass) before marking the feature complete.
- [X] T020 Run `npm run test:unit -- --run` and `npm run test:e2e` for the full suite, and
      manually walk through all 6 [quickstart.md](quickstart.md) scenarios via `npm run dev`
      as a final sanity check.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational and on US1's `importRows()` extension
  (T007) and `ImportPage.tsx` account-column selector (T009), which it extends — not on any
  US1 test task.
- **User Story 3 (Phase 5)**: Depends on US1's per-account map (T008) and `ImportPage.tsx`
  account-column selector (T009) — independent of US2's collision/preview work (T010-T014).
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each Phase

- Tests MUST be written and confirmed failing before the implementation task(s) that follow
  them.
- Foundational: T002 must land before T003 can be exercised against real `ColumnMapping`
  values, but T003 and T004 touch different files and can be written in parallel; T003 has no
  dependency on T002 to compile on its own.
- US1: T005 can proceed alongside T002/T003 landing (write the test first, watch it fail);
  T006 depends on T002; T007 depends on T002, T003; T008 depends on T007; T009 depends on
  T004, T007.
- US2: T010 and T011 can be written in parallel; T012 depends on T003; T013 depends on T007,
  T012; T014 depends on T009, T012.
- US3: T015 can be written once T007/T008 exist to exercise; T016 depends on T008, T015; T017
  depends on T016.
- Polish: T018 depends on all user stories; T019 depends on T018; T020 last.

### Parallel Opportunities

- Foundational: T003 and T004 together (different files).
- US1: T005 and T006 together (tests, same file but independent test bodies — write both,
  then implement).
- US2: T010 and T011 together (tests).
- US3: T015 alone (single test task).

---

## Parallel Example: Foundational Phase

```bash
Task: "Add resolveAccountForRow to src/data/io/importService.ts"
Task: "Fetch accounts including archived in src/pages/ImportPage.tsx, derive activeAccounts"
```

## Parallel Example: User Story 1

```bash
Task: "Write failing unit tests for resolveAccountForRow in tests/unit/importService.test.ts"
Task: "Write failing unit tests for multi-account importRows() routing in tests/unit/importService.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks everything else).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1, 2, and 4 independently.
5. This alone delivers the feature's core value — one file, multiple accounts, correctly
   routed — before the safety-net UI (US2) or the summary display (US3) are layered on.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → multi-account routing fully works (MVP!).
3. User Story 2 → validate independently → mistakes are caught/blocked before commit, without
   changing US1's routing behavior.
4. User Story 3 → validate independently → per-account result summary on top of US1's data.
5. Polish → E2E coverage and a final Constitution compliance pass.

## Notes

- [P] tasks touch different files, or the same file in a way that doesn't conflict (e.g. two
  independent test bodies added to the same test file).
- Every task in a user-story phase carries that story's label for traceability.
- No Dexie schema change and no new npm dependency anywhere in this feature (plan.md).
- The pre-existing `architecture.md`/`checklist.md`/`test-cases.md` in this feature directory
  predate this Spec Kit workflow and have been updated to match the finalized design in
  `spec.md`/`plan.md`/`research.md`/`data-model.md`/`contracts/` (name-only matching, archived
  accounts eligible, whole-file collision blocking) — all documents in this directory are now
  consistent.
