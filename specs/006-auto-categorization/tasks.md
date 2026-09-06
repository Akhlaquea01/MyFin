---
description: 'Task list template for feature implementation'
---

# Tasks: Auto-Categorization Rules & Learning

**Input**: Design documents from `/specs/006-auto-categorization/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/categorization-engine.md](contracts/categorization-engine.md),
[quickstart.md](quickstart.md)

**Tests**: Included. Not one of Constitution Principle IV's four named engines, but held to
its bar per the precedent already set for specs 002-004 (plan.md's Constitution Check) — the
pure `pickBestRule`/`deriveSuggestion` functions and the repository/orchestrator layer get
unit + integration tests before being considered done.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3). Stories are
built as additive layers on one shared `resolveCategorization()` orchestrator: US1 ships it
with only a rule-matching path (a `null` fallback where the suggestion path will go); US2
extends that same function with the suggestion path. This keeps each story independently
testable/shippable without forward-referencing a story that hasn't landed yet.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths below are real paths in this repository, following the conventions in
  `src/data/dexie/savingsGoalRepository.ts` (repository + soft-delete pattern) and
  `src/domain/notifications/` (pure-engine + thin-orchestrator pattern, spec 004).

---

## Phase 1: Setup

**Purpose**: Establish a clean baseline before touching any code

- [X] T001 Confirm no new npm dependency is required (plan.md's Technical Context — reuses
      the existing stack only) and run `npm run test` to confirm the suite passes cleanly
      before starting, establishing a baseline to diff against.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Entities, storage, and the merchant-resolution plumbing every story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Add `CategorizationRule` and `MerchantCategorySignal` interfaces to
      `src/domain/entities.ts` per [data-model.md](data-model.md): `CategorizationRule extends
Timestamped, SoftDeletable` with `id, merchantId, merchantAliasId: ID | null, categoryId,
      tagIds: ID[]`; `MerchantCategorySignal extends Timestamped` with `id` (= the merchant's
      own id), `recentCategoryIds: ID[]`. Also add the optional
      `categorizationSource?: 'rule' | 'suggestion'` field to the existing `TransactionSplit`
      interface.
- [X] T003 [P] Add `categorizationRules` and `merchantCategorySignals` encrypted tables to
      `src/data/dexie/db.ts`: `CategorizationRuleRow extends EncryptedRow { merchantId:
string; deletedAt: number }`, `MerchantCategorySignalRow extends EncryptedRow {}` (no extra
      indexed columns — keyed by its own `id`), add both properties to `MyFinDatabase`, and
      bump to `this.version(6).stores({ categorizationRules: 'id, merchantId, deletedAt',
merchantCategorySignals: 'id' })` (additive-only per Dexie's versioning model; do not modify
      earlier `version()` blocks).
- [X] T004 Change `resolveMerchant(key, rawMerchantText)` in
      `src/domain/parser/merchantResolver.ts` to return `{ merchantId: string; aliasId:
string }` instead of a bare `string` (research.md §1 — both branches already have the alias's
      `id` at hand). Update its two existing call sites,
      `src/pages/QuickAddPage.tsx`'s `handleConfirm()` and
      `src/data/io/bulkTextImportService.ts`'s `importBulkText()`, to destructure the new
      shape and pass both `merchantId` and the new `merchantAliasId` field (added in T005)
      into their `TransactionEngine.recordTransaction` call.
- [X] T005 In `src/data/dexie/transactionRepository.ts`: add `merchantAliasId?: string | null`
      to `NewTransactionInput` (read only by `TransactionEngine.recordTransaction`, not by
      `TransactionRepository.create` itself) and `categorizationSource?: 'rule' | 'suggestion'`
      to `SplitInput`; thread that field through into the `TransactionSplit` object built in
      both `create()` and `update()` wherever `splitEntity` is constructed.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Define an Auto-Categorization Rule (Priority: P1) 🎯 MVP

**Goal**: A user-authored merchant/alias → category+tags rule pre-fills every newly proposed
transaction from Quick Add, bulk text import, or file import; the Review Queue lets the user
see and change that pre-fill before confirming; editing/deleting a rule only affects future
proposals.

**Independent Test**: Create a rule mapping a merchant to a category, then process a new
Quick Add or import entry recognized as that merchant, and verify the resulting unreviewed
transaction is pre-filled with that category (per [quickstart.md](quickstart.md) Scenarios 1,
2).

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they fail before writing the implementation.

- [X] T006 [P] [US1] Write failing unit tests in `tests/unit/categorizationEngine.test.ts` for
      `pickBestRule(rules, merchantId, aliasId)`: an alias-scoped rule wins over a
      merchant-scoped rule for the same merchant (quickstart Scenario 5's precedence half);
      a merchant-scoped rule applies when no alias-scoped rule exists; returns `null` when no
      rule matches at all.
- [X] T007 [P] [US1] Write failing integration tests in
      `tests/integration/categorizationRepositories.test.ts` for `CategorizationRuleRepository`
      (`create`/`update`/`softDelete`/`restore`/`listForMerchant`/`list` with a derived
      `isInvalid` flag when the target category is soft-deleted — quickstart Scenario 8) and
      for `resolveCategorization`'s rule-only path exercised through all three entry points
      (`TransactionEngine.recordTransaction` called as Quick Add, bulk import, and file
      import each would) — quickstart Scenario 1.

### Implementation for User Story 1

- [X] T008 [P] [US1] Implement `CategorizationRuleRepository` in
      `src/data/dexie/categorizationRuleRepository.ts` per
      [contracts/categorization-engine.md](contracts/categorization-engine.md):
      `create`/`update`/`softDelete`/`restore` (mirroring `SavingsGoalRepository`'s shape in
      `src/data/dexie/savingsGoalRepository.ts`), `listForMerchant` (live rows only), and
      `list` returning each rule alongside a derived `isInvalid: boolean` computed against
      `CategoryRepository.getById` (research.md §5 — never persisted). Depends on T002, T003.
      Must make T007's repository tests pass.
- [X] T009 [US1] Implement `pickBestRule` in
      `src/domain/categorization/categorizationEngine.ts` per
      [contracts/categorization-engine.md](contracts/categorization-engine.md) — pure,
      no I/O. Must make T006's tests pass.
- [X] T010 [US1] Implement `resolveCategorization(key, merchantId, aliasId)` in
      `src/domain/categorization/resolveCategorization.ts`: loads live rules via
      `CategorizationRuleRepository.listForMerchant`, drops any whose category is
      soft-deleted/missing (FR-009), calls `pickBestRule`, and returns
      `{ categoryId, tagIds, source: 'rule' }` on a match or `null` otherwise (the
      suggestion path is added in T021). Depends on T008, T009.
- [X] T011 [US1] Extend `TransactionEngine.recordTransaction` in
      `src/domain/transactions/transactionEngine.ts`: when called with `splits.length === 0`
      and `input.merchantId` set, call `resolveCategorization(key, input.merchantId,
input.merchantAliasId)`; on a result, build one full-amount split
      `{ categoryId, amount: input.amount, categorizationSource: source }` and, if
      `tagIds.length > 0`, call `TransactionTagRepository.setTags(key, tx.id, tagIds)` after
      creation. Also add `confirmTransaction(key, txId, splits?, tagIds?)`: calls
      `TransactionRepository.update(key, txId, { reviewStatus: 'confirmed' }, splits)`, then
      `TransactionTagRepository.setTags` if `tagIds` is given (the `recordConfirmation` call
      described in contracts/categorization-engine.md is added in T022). Depends on T005,
      T010.
- [X] T012 [US1] In `src/data/io/importService.ts`'s `importRows()`, resolve a `Merchant` per
      row via `resolveMerchant(key, <description column value>)` (research.md §4) and pass
      the resulting `merchantId`/`merchantAliasId` into the `NewTransactionInput` given to
      `TransactionEngine.recordTransaction` — file import currently resolves no merchant at
      all. Depends on T004.
- [X] T013 [US1] Extend `src/pages/ReviewPage.tsx`: for each queued transaction, load its
      splits/tags and show an editable category selector (and tag picker) defaulting to
      whatever was pre-filled; `accept(tx)` calls the new
      `TransactionEngine.confirmTransaction(key, tx.id, editedSplits, editedTagIds)` instead
      of calling `TransactionRepository.update` directly, so a user can change the pre-filled
      category before confirming (Acceptance Scenario 3). Depends on T011.
- [X] T014 [US1] Create `src/pages/CategorizationRulesPage.tsx`: a list of existing rules
      (merchant name, alias scope if any, category, tags, an "Invalid" badge when
      `isInvalid`) with create/edit/delete actions backed by `CategorizationRuleRepository`.
      Depends on T008.
- [X] T015 [US1] Register the new page: add
      `<Route path="categorization-rules" element={<CategorizationRulesPage />} />` in
      `src/App.tsx` and a nav entry (e.g. `{ to: '/categorization-rules', label:
'Auto-Categorize', icon: Wand2 }`) in `src/components/AppShell.tsx`'s nav items array.
      Depends on T014.
- [X] T016 [US1] Add a "Categorization Rules" section to `src/pages/TrashPage.tsx` (list
      soft-deleted rules via `db.categorizationRules.filter(...)`, decrypt, and a `restore`
      action via `CategorizationRuleRepository.restore`), mirroring the existing
      Accounts/Transactions/Savings Goals sections there (Constitution Principle VI — every
      soft-deletable entity gets a restore path). Depends on T008.

**Checkpoint**: User Story 1 is fully functional and independently testable — rule CRUD,
pre-fill across all three entry paths, review-time override, and edit/delete affecting only
future proposals all work, with no learned-suggestion behavior involved yet.

---

## Phase 4: User Story 2 - Suggested Category from Past Corrections (Priority: P2)

**Goal**: After a merchant's confirmations settle into a consistent streak, new proposals from
that merchant are pre-filled with the learned category, visibly marked as a suggestion, and
lose to an explicit rule when both would apply.

**Independent Test**: Confirm several transactions from the same merchant into the same
category during review (no rule involved), then verify a subsequent transaction from that
merchant is pre-filled with that category, marked as a suggestion (per
[quickstart.md](quickstart.md) Scenarios 3, 4, 5).

### Tests for User Story 2 ⚠️

- [X] T017 [P] [US2] Add failing unit tests to `tests/unit/categorizationEngine.test.ts` for
      `deriveSuggestion(recentCategoryIds, minStreak)`: returns the shared category once 3
      identical entries are present; returns `null` below 3 entries; returns `null` for an
      alternating (non-dominant) history, however long (quickstart Scenario 4).
- [X] T018 [P] [US2] Add failing integration tests to
      `tests/integration/categorizationRepositories.test.ts` for
      `MerchantCategorySignalRepository` (`get`/`push` capping at 3 entries FIFO/`reset`) and
      for `resolveCategorization`'s suggestion path: no rule + a 3-confirmation streak yields
      a `source: 'suggestion'` result; an explicit rule still wins over an active streak for
      the same merchant (quickstart Scenario 5); confirming with an overridden category
      (via `TransactionEngine.confirmTransaction`) shifts the streak so the old pattern stops
      being suggested (quickstart Scenario 3 step 5-6).

### Implementation for User Story 2

- [X] T019 [US2] Implement `MerchantCategorySignalRepository` in
      `src/data/dexie/merchantCategorySignalRepository.ts` per
      [contracts/categorization-engine.md](contracts/categorization-engine.md): `get(key,
merchantId)`, `push(key, merchantId, categoryId)` (read-modify-write, capping
      `recentCategoryIds` at `MIN_STREAK` = 3, FIFO), `reset(key, merchantId)`. Depends on
      T002, T003. Must make T018's repository tests pass.
- [X] T020 [US2] Add `deriveSuggestion` to
      `src/domain/categorization/categorizationEngine.ts` (module-level `MIN_STREAK = 3`
      constant, mirroring `quickAddParser.ts`'s `CONFIDENCE_THRESHOLD` precedent — no
      settings/repository needed per the spec's own Assumption). Must make T017's tests pass.
- [X] T021 [US2] Extend `resolveCategorization` in
      `src/domain/categorization/resolveCategorization.ts`: when no rule matches, load
      `MerchantCategorySignalRepository.get(key, merchantId)`, call `deriveSuggestion` on its
      `recentCategoryIds`, and — only if the resulting category isn't itself soft-deleted —
      return `{ categoryId, tagIds: [], source: 'suggestion' }`; otherwise `null`. Depends on
      T010, T019, T020. Must make the suggestion-path half of T018's tests pass.
- [X] T022 [US2] Add `recordConfirmation(key, merchantId, categoryId)` to
      `src/domain/categorization/resolveCategorization.ts` (or a sibling module) per the
      contract, and call it from `TransactionEngine.confirmTransaction`
      (`src/domain/transactions/transactionEngine.ts`, from T011) after the transaction/splits
      are updated, using the transaction's `merchantId` and its (possibly just-edited) first
      split's `categoryId` — skipped silently when the transaction has no `merchantId`.
      Depends on T011, T019. Must make the override-shifts-the-streak half of T018's tests
      pass.
- [X] T023 [US2] In `src/pages/ReviewPage.tsx`, show a "Suggested" badge (distinct from a
      plain pre-fill) on any queued transaction whose first split has
      `categorizationSource === 'suggestion'` (FR-004). Depends on T013, T021.

**Checkpoint**: User Stories 1 and 2 both work independently — explicit rules and learned
suggestions both pre-fill correctly, a rule always wins when both would apply, and overriding
a suggestion during review reshapes future suggestions for that merchant.

---

## Phase 5: User Story 3 - Review and Manage Learned Suggestions (Priority: P3)

**Goal**: A user can see what the app has learned per merchant and either promote it to a
permanent rule or dismiss/reset it.

**Independent Test**: With a learned suggestion active for a merchant, promote it to an
explicit rule and verify it now behaves identically to a manually created rule; separately,
reset a learned suggestion and verify pre-filling stops until the pattern re-forms (per
[quickstart.md](quickstart.md) Scenarios 6, 7).

### Tests for User Story 3 ⚠️

- [X] T024 [P] [US3] Add failing integration tests to
      `tests/integration/categorizationRepositories.test.ts` for
      `MerchantCategorySignalRepository.listSuggestions` (returns only merchants whose
      derived suggestion is non-null and whose category isn't stale) and for the
      promote-then-immediately-matches-as-a-rule flow (quickstart Scenario 6: creating a
      `CategorizationRule` from a suggestion's merchant/category makes the very next
      `resolveCategorization` call for that merchant return `source: 'rule'`).

### Implementation for User Story 3

- [X] T025 [US3] Add `listSuggestions(key)` to
      `src/data/dexie/merchantCategorySignalRepository.ts` per
      [contracts/categorization-engine.md](contracts/categorization-engine.md) — scans all
      signal rows, applies `deriveSuggestion`, and drops any whose resulting category is
      soft-deleted. Depends on T019, T020. Must make T024's `listSuggestions` test pass.
- [X] T026 [US3] Add a "Learned Suggestions" section to
      `src/pages/CategorizationRulesPage.tsx` (from T014): lists each suggestion (merchant
      name, suggested category) with "Promote" (calls
      `CategorizationRuleRepository.create` with that merchant/category, no alias scope, no
      tags) and "Reset" (calls `MerchantCategorySignalRepository.reset`) actions, refreshing
      both lists after either action. Depends on T014, T025.

**Checkpoint**: All three user stories are independently functional — rules, learned
suggestions, and suggestion management all work end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T027 [P] Extend `src/data/io/backupService.ts` to include `categorizationRules` and
      `merchantCategorySignals` (spec.md's Assumptions — local-only data, backed up like
      everything else): add both arrays to `BackupPayload.exportedEntities`, read/decrypt them
      in `collectPayload`, and add the matching encrypt/`db.transaction([...])`/`clear()`/
      `bulkPut()` steps in `restoreBackup`, following the existing `savingsGoals`/
      `goalContributions` pattern exactly. Bump `CURRENT_SCHEMA_VERSION`, add the next
      `src/data/io/migrations/vX.ts` identity migration, and update the prior version's
      migration to default both new fields to `[]` for older backups — re-read
      `backupService.ts`'s current state first, since other in-flight work may have already
      advanced its schema version past what research.md/data-model.md describe. Extend
      `tests/unit/backupService.test.ts` with a round-trip case covering both tables.
- [X] T028 [P] Write E2E test `tests/e2e/autoCategorization.spec.ts` covering
      [quickstart.md](quickstart.md) Scenarios 1, 2, 3, 5, 6, 7 end-to-end through the actual
      Quick Add, Review Queue, and Categorization Rules UI.
- [X] T029 Review all new code against Constitution Principle III (`categorizationEngine.ts`
      has no dependents in `src/domain/` outside its own orchestrator; `UI` components call
      only the repositories/`TransactionEngine`, never Dexie directly) and Principle VI
      (`CategorizationRule` soft-delete/restore works via Trash, no destructive fix-up of an
      existing confirmed transaction anywhere in this feature) before marking the feature
      complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational and on US1's `resolveCategorization`
  (T010) and `confirmTransaction` (T011) shells, which it extends — not on US1's UI tasks
  (T013-T016).
- **User Story 3 (Phase 5)**: Depends on US2's `MerchantCategorySignalRepository` (T019) and
  `deriveSuggestion` (T020), and on US1's `CategorizationRulesPage` (T014) and
  `CategorizationRuleRepository.create` (T008).
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each Phase

- Tests MUST be written and confirmed failing before the implementation task(s) that follow
  them.
- Foundational: T002 and T003 touch different files and can run in parallel; T004 and T005
  can each start once T002/T003 land.
- US1: T006 and T007 can run in parallel (different files); T008 depends on T002/T003; T009
  is independent of T008 (pure function) but its test (T006) should fail first; T010 depends
  on T008 and T009; T011 depends on T005 and T010; T012 depends on T004; T013 depends on
  T011; T014 depends on T008; T015 depends on T014; T016 depends on T008.
- US2: T017 and T018 can run in parallel; T019 depends on T002/T003; T020 is independent of
  T019 (pure function); T021 depends on T010, T019, T020; T022 depends on T011, T019; T023
  depends on T013, T021.
- US3: T025 depends on T019, T020; T026 depends on T014, T025.
- Polish: T027 and T028 can run in parallel once all stories are complete; T029 last.

### Parallel Opportunities

- Foundational: T002, T003 together.
- US1: T006, T007 together (tests); T009 can proceed alongside T008 (different files).
- US2: T017, T018 together (tests); T020 can proceed alongside T019 (different files).
- Polish: T027, T028 together.

---

## Parallel Example: Foundational Phase

```bash
Task: "Add CategorizationRule/MerchantCategorySignal interfaces to src/domain/entities.ts"
Task: "Add categorizationRules/merchantCategorySignals tables to src/data/dexie/db.ts"
```

## Parallel Example: User Story 1

```bash
Task: "Write failing unit tests in tests/unit/categorizationEngine.test.ts"
Task: "Write failing integration tests in tests/integration/categorizationRepositories.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks everything else).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1, 2, and 8 independently.
5. This alone delivers the spec's core, most-predictable value — explicit rules pre-filling
   every entry path, editable at review time — before any learning behavior is layered on.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → rules fully work end-to-end (MVP!).
3. User Story 2 → validate independently → learned suggestions layer on top without changing
   US1's behavior.
4. User Story 3 → validate independently → promote/reset management on top of US2's data.
5. Polish → backup inclusion, E2E coverage, and a final Constitution compliance pass.

## Notes

- [P] tasks touch different files with no unmet dependency.
- Every task in a user-story phase carries that story's label for traceability.
- Commit after each task or logical group; verify a test fails before implementing against
  it, and passes immediately after.
- T027 touches `backupService.ts`, a file recent specs (002-005) have each extended in turn —
  re-read its current state before editing rather than assuming the shape described in
  research.md/data-model.md is exactly what's on disk.
