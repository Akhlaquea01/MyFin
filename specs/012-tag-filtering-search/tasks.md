---
description: 'Task list template for feature implementation'
---

# Tasks: Tag-Based Filtering & Search for Transactions

**Input**: Design documents from `/specs/012-tag-filtering-search/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/tag-filter-engine.md](contracts/tag-filter-engine.md),
[quickstart.md](quickstart.md)

**Tests**: Included. Not one of Constitution Principle IV's four named engines, but held to its
bar per the precedent already set for specs 002-004/006/007/011 (plan.md's Constitution Check) —
the pure functions in `tagFilterEngine.ts` and the two repository extensions that consume them
get unit/integration tests before being considered done.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3). All three stories
build on one shared `tagFilterEngine.ts` + `TagRepository.listInUse` foundation: US1 delivers the
core tag filter (select one or more tags, see only matching transactions), US2 layers
type-to-narrow discovery and an explicit empty state onto the same control, US3 is a data-layer-
only extension of the existing free-text search that needs no new UI. This keeps each story
independently testable/shippable without forward-referencing a story that hasn't landed yet.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths below are real paths in this repository, following the pure-engine + thin-
  repository split already established by `src/domain/reports/reportEngine.ts` (spec 011) and
  `src/domain/analytics/financialHealthEngine.ts` (spec 007), and the existing
  `src/pages/TransactionsPage.tsx` filter-row pattern this feature extends in place.

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before touching any code

- [X] T001 Run `npm run test` to confirm the existing suite passes cleanly before starting,
      establishing a baseline to diff against. No new dependency to install — research.md §6
      confirms the one new UI primitive (`popover.tsx`) wraps the already-present `radix-ui`
      package.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared pure engine, the popover primitive, and the tag-in-use repository lookup
every story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Add the `TagOption` type and the six function signatures — `matchesAnyTag`,
      `normalizeTagText`, `tagNameMatchesQuery`, `filterTagOptions`, `distinctTagIdsInUse`,
      `transactionMatchesFreeText` — to `src/domain/transactions/tagFilterEngine.ts` per
      [data-model.md](data-model.md) and [contracts/tag-filter-engine.md](contracts/tag-filter-engine.md).
- [X] T003 [P] Write failing unit tests in `tests/unit/tagFilterEngine.test.ts` for all six
      functions per [contracts/tag-filter-engine.md](contracts/tag-filter-engine.md):
      `matchesAnyTag` (shared id → true; disjoint ids → false; empty `selectedTagIds` → true
      unconditionally); `normalizeTagText`/`tagNameMatchesQuery` (case/whitespace-insensitive
      substring match; empty query → true); `filterTagOptions` (narrows and preserves input
      order); `distinctTagIdsInUse` (a tag referenced only by a deleted transaction is excluded;
      a tag referenced by both a live and a deleted transaction is included; empty input → empty
      set); `transactionMatchesFreeText` (matches on `notes`, matches on any tag name, matches
      neither → false, partial tag-name match e.g. "japan" against "trip:japan"). Depends on
      T002 (needs the types/signatures to compile against).
- [X] T004 Implement all six functions in `src/domain/transactions/tagFilterEngine.ts` per
      [contracts/tag-filter-engine.md](contracts/tag-filter-engine.md) — pure, no I/O, no
      `CryptoKey`, no Dexie import. Must make T003's tests pass. Depends on T002, T003.
- [X] T005 [P] Create `src/components/ui/popover.tsx`: a shadcn-style wrapper over the
      already-present `radix-ui` package's `Popover` primitive (`Popover`, `PopoverTrigger`,
      `PopoverContent`), following the same wrapping pattern `src/components/ui/dropdown-menu.tsx`
      already uses for that package's menu primitive (research.md §6). No dependency on T002-T004.
- [X] T006 [P] Write failing integration tests in `tests/integration/ledgerRepositories.test.ts`
      for a new `TagRepository.listInUse(key)`: a tag referenced by a live transaction appears
      in the result; a tag referenced only by a soft-deleted transaction is excluded; a profile
      with zero tags returns `[]`; results are sorted case-insensitively by name (data-model.md,
      contracts/tag-filter-engine.md). Depends on T004 (the repository implementation will use
      `distinctTagIdsInUse`).
- [X] T007 Implement `TagRepository.listInUse(key): Promise<TagOption[]>` in
      `src/data/dexie/tagRepository.ts` per [contracts/tag-filter-engine.md](contracts/tag-filter-engine.md):
      fetch all `transactionTags` rows, fetch live transaction ids via the existing
      `db.transactions.where('deletedAt').equals(NOT_DELETED)` index, compute the in-use tag id
      set via `distinctTagIdsInUse`, filter/decrypt `TagRepository.list(key)` down to that set,
      sort by `normalizeTagText(name)`. Must make T006's tests pass. Depends on T004, T006.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Filter transactions by tag (Priority: P1) 🎯 MVP

**Goal**: A user selects one or more existing tags and sees only transactions carrying at least
one of them, combined correctly with any other active filter (account, date range, free text).

**Independent Test**: Tag several transactions across different categories with the same tag,
apply that tag as a filter on the transaction list, and verify only those transactions appear
(per [quickstart.md](quickstart.md) Scenarios 1-4).

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they fail before writing the implementation.

- [X] T008 [US1] Write failing integration tests in
      `tests/integration/ledgerRepositories.test.ts` for `TransactionRepository.search`'s
      `tagIds` filter: a single selected tag returns only transactions carrying it (Scenario 1);
      the tag filter composes with an active `accountId`/date-range filter so only transactions
      satisfying both appear (Scenario 2); two selected tags return the union of transactions
      carrying either one (OR semantics — Scenario 3, FR-002); an empty/absent `tagIds` behaves
      identically to no tag filter (Scenario 4, FR-008). Sequenced after T006/T007 (same test
      file).

### Implementation for User Story 1

- [X] T009 [US1] In `src/data/dexie/transactionRepository.ts`: replace
      `TransactionFilter.tagId?: string` with `tagIds?: string[]`, and reimplement `search()`'s
      tag-narrowing block (currently lines ~400-404) as
      `db.transactionTags.where('tagId').anyOf(filter.tagIds).toArray()` → filter transactions
      down to the set of `transactionId`s returned (research.md §2). Must make T008's tests
      pass. Depends on T008.
- [X] T010 [US1] Add a tag-filter control to `src/pages/TransactionsPage.tsx`'s existing filter
      `Card` row: a `Popover` (T005) trigger button showing every tag from
      `TagRepository.listInUse(key)` (T007) as a toggleable row, selected tags rendered as
      removable `Badge`s next to the control, a "Clear tags" action, and copy making clear
      selecting multiple tags matches *any* of them (FR-002). Wires the selected tag id array
      into the existing `refresh()`'s `TransactionRepository.search(key, {...})` call as
      `tagIds`. Depends on T007, T009, T005.

**Checkpoint**: User Story 1 is fully functional and independently testable — tag filtering
works standalone and composes correctly with every other existing filter.

---

## Phase 4: User Story 2 - Discover and pick existing tags while filtering (Priority: P2)

**Goal**: Rather than retyping exact tag spelling, the user picks from every tag that already
exists, narrowing the list by typing.

**Independent Test**: Create a few distinctly-named tags via existing transaction entry, open
the tag filter control, and verify every existing tag appears as a selectable option with no
need to type it from memory, and that typing a few characters narrows the list (per
[quickstart.md](quickstart.md) Scenarios 5-6). The narrowing/matching logic itself
(`filterTagOptions`/`tagNameMatchesQuery`) is already unit-tested in Foundational (T003) — this
phase is UI wiring on top of it.

### Implementation for User Story 2

- [X] T011 [US2] Extend the tag-filter `Popover` content built in T010
      (`src/pages/TransactionsPage.tsx`): add a text `Input` above the tag list that narrows the
      displayed options via `filterTagOptions(tags, query)` as the user types (FR-005), and
      render an explicit "No tags yet" message in place of the list when
      `TagRepository.listInUse(key)` returns `[]` (Acceptance Scenario 3, FR-009's edge case)
      rather than an empty, unexplained box. Depends on T010.

**Checkpoint**: User Stories 1 and 2 both work independently — tags can be selected directly or
found by typing a partial name, and an empty-tags profile shows a clear message instead of
nothing.

---

## Phase 5: User Story 3 - Search transactions by tag text (Priority: P3)

**Goal**: The existing free-text transaction search also matches tag text, with no new control.

**Independent Test**: Type a tag's text (or part of one) into the existing transaction search
box and verify transactions carrying a matching tag are included, even when the typed text
matches neither notes nor merchant (per [quickstart.md](quickstart.md) Scenario 8).

### Tests for User Story 3 ⚠️

- [X] T012 [US3] Write failing integration tests in
      `tests/integration/ledgerRepositories.test.ts` for `TransactionRepository.search`'s
      free-text step: a transaction whose only match to a search term is one of its tags (not
      `notes`) is included (Acceptance Scenario 1); a search term that partially matches a tag
      (e.g. `"japan"` matching `"trip:japan"`) includes the transaction (Acceptance Scenario 2);
      matching is case-insensitive (FR-007). Sequenced after T008 (same test file).

### Implementation for User Story 3

- [X] T013 [US3] Extend `search()`'s free-text step in
      `src/data/dexie/transactionRepository.ts` (currently lines ~406-409): when
      `filter.freeText` is set, batch-fetch `transactionTags` rows for exactly the current
      candidate transaction ids, resolve tag names via `TagRepository.list(key)`'s `id → name`
      map, and keep a transaction when
      `transactionMatchesFreeText(tx.notes, tagNamesForTx, normalizeTagText(filter.freeText))`
      is true (research.md §3) — extends, never replaces, the existing `notes`-only check. Must
      make T012's tests pass. Depends on T012, T009 (extends the same function T009 already
      touched).

**Checkpoint**: All three user stories are independently functional — tag filtering, tag
discovery, and tag-aware free-text search all work, individually and together.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T014 [P] Write E2E test `tests/e2e/tagFilteringSearch.spec.ts` covering
      [quickstart.md](quickstart.md) Scenarios 1, 3, 5, 6, and 8: filter by a single tag, filter
      by multiple tags (OR), open the pick-list and narrow it by typing, confirm the "no tags
      yet" empty state on a fresh profile, and search by tag text via the existing search box.
- [X] T015 Review all new code against Constitution Principle III (`tagFilterEngine.ts` has zero
      repository/Dexie imports; `TransactionsPage.tsx` calls only `TagRepository`/
      `TransactionRepository`, never `db` directly) and Principle V (confirm `package.json` has
      no new dependency — `popover.tsx` imports only the already-present `radix-ui` package).
      Also confirm no schema change was introduced (this feature persists nothing new —
      data-model.md, research.md §7), i.e. `src/data/dexie/db.ts`'s version count is untouched
      by this feature's diff.
- [X] T016 [P] Run [quickstart.md](quickstart.md)'s Scenarios 1-9 manually against the dev build
      (`npm run dev`) to confirm the written scenarios match actual behavior, including Scenario
      7 (a tag dropping out of the pick-list once its last transaction is deleted) and Scenario 9
      (case-insensitive matching for a mixed-case tag name), which the automated tests cover at
      the data layer but are worth eyeballing end-to-end.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational, and on US1's tag-filter `Popover` (T010)
  which it extends with narrowing/empty-state — not on US3.
- **User Story 3 (Phase 5)**: Depends on Foundational, and on US1's `search()` edit (T009) since
  it extends the same function — not on US2 (no shared file/logic).
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each Phase

- Tests MUST be written and confirmed failing before the implementation task(s) that follow them.
- Foundational: T002 must land before T003 (tests need the types); T004 implements against T003;
  T005 is independent of T002-T004; T006 depends on T004 (repository will use
  `distinctTagIdsInUse`); T007 implements against T006.
- US1: T008 is written against T004's contract before T009 implements the repository change;
  T010 depends on T007, T009, and T005.
- US2: T011 depends on T010 (extends the same `Popover` content).
- US3: T012 is written before T013 implements against it; T013 depends on T009 (same function,
  sequenced after US1's edit lands to avoid conflicting concurrent edits to `search()`).
- Polish: T014, T015, T016 can run in parallel once all stories are complete.

### Parallel Opportunities

- Foundational: T002 and T005 can start in parallel (unrelated files); T003 follows T002; T006
  can be drafted in parallel with US1's early tasks once T004 lands.
- US1: T008 has no other US1 task to run alongside (T009 depends on it).
- US3: T012 has no other US3 task to run alongside (T013 depends on it).
- Polish: T014 and T016 touch different concerns (automated E2E vs. manual walkthrough) and can
  proceed in parallel; T015 (a code review pass) can run alongside both.

---

## Parallel Example: Foundational Phase

```bash
Task: "Add TagOption type + tagFilterEngine.ts function signatures in src/domain/transactions/tagFilterEngine.ts"
Task: "Create src/components/ui/popover.tsx wrapping the radix-ui Popover primitive"
```

## Parallel Example: Polish Phase

```bash
Task: "Write E2E test tests/e2e/tagFilteringSearch.spec.ts"
Task: "Run quickstart.md Scenarios 1-9 manually against the dev build"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks everything else).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1-4 independently.
5. This alone delivers the spec's core, most load-bearing value — tags become usable for
   narrowing the transaction list — before discovery polish or search-box integration is added.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → tag filtering works, composes with existing filters
   (MVP!).
3. User Story 2 → validate independently → tags are discoverable and narrowable without exact
   recall.
4. User Story 3 → validate independently → the existing search box also matches tag text.
5. Polish → E2E coverage, a Constitution/dependency-count compliance pass, and a full manual
   quickstart walkthrough.

## Notes

- [P] tasks touch different files with no unmet dependency.
- Every task in a user-story phase carries that story's label for traceability.
- Commit after each task or logical group; verify a test fails before implementing against it,
  and passes immediately after.
- This feature introduces no new Dexie table, no schema version bump, and no new runtime
  dependency — T015 exists specifically to confirm that stayed true.
- `TransactionFilter.tagId?: string` is renamed to `tagIds?: string[]` in T009; grep confirmed no
  existing caller passes `tagId` today, so this is a non-breaking change (research.md §2).
