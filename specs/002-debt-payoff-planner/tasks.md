---
description: 'Task list template for feature implementation'
---

# Tasks: Debt Payoff Planner

**Input**: Design documents from `/specs/002-debt-payoff-planner/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/debt-payoff-engine.md](contracts/debt-payoff-engine.md),
[quickstart.md](quickstart.md)

**Tests**: Included and REQUIRED, not optional. Constitution Principle IV mandates test-first
development for money-affecting logic, and the plan's Constitution Check holds this engine
to that same bar even though it isn't one of the four engines named explicitly in the
principle — see plan.md's Constitution Check table.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3) so each story
can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths below are real paths in this repository, matching existing conventions (see
  `src/data/dexie/wealthRepository.ts` and `src/data/dexie/userProfileRepository.ts` for the
  patterns referenced throughout)

---

## Phase 1: Setup

**Purpose**: Establish a clean baseline before touching any code

- [x] T001 Confirm no new npm dependency is required (per [research.md](research.md) §5) and
      run the existing test suite (`npm run test`) to confirm it passes cleanly before
      starting, establishing a clean baseline to diff against.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, entity fields, and storage that every user story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Create `src/domain/debtPlanner/types.ts` defining `DebtPayoffPlan`,
      `DebtPayoffPlanEntry` (including a `nonConverging: boolean` field per FR-010),
      `MonthlyScheduleEntry`, `GeneratePlanInput`, and `EligibleLiability`, matching the
      shapes in [data-model.md](data-model.md) and
      [contracts/debt-payoff-engine.md](contracts/debt-payoff-engine.md).
- [x] T003 [P] Extend `Liability` in `src/domain/entities.ts` with `interestRate: number | null`
      (annual rate in basis points) and `minimumPayment: number | null` (smallest currency
      unit); add a new `DebtPlannerPreference` interface (`id: 'local-user'`,
      `strategy: 'avalanche' | 'snowball'`, `extraMonthlyPayment: number`, `createdAt`,
      `updatedAt`) per [data-model.md](data-model.md).
- [x] T004 [P] Add a `debtPlannerPreferences` encrypted table to
      `src/data/dexie/db.ts`: define `DebtPlannerPreferenceRow extends EncryptedRow` (no
      extra indexed columns beyond `id`), add the `debtPlannerPreferences` property to
      `MyFinDatabase`, and bump to `this.version(2).stores({ ...all existing tables
unchanged..., debtPlannerPreferences: 'id' })` (follow Dexie's additive-version-bump
      pattern; do not modify the `version(1)` block).
- [x] T005 Update `LiabilityRepository.create` and `.update` in
      `src/data/dexie/wealthRepository.ts` to accept and persist `interestRate` and
      `minimumPayment` on the `Liability` entity (no new indexed column — these fields live
      in the existing `liabilities` table's encrypted blob). Depends on T003.
- [x] T006 Create `DebtPlannerPreferenceRepository` in
      `src/data/dexie/debtPlannerPreferenceRepository.ts` with `get(key: CryptoKey):
Promise<DebtPlannerPreference>` (returns the decrypted singleton, or an in-memory
      default of `{ id: 'local-user', strategy: 'avalanche', extraMonthlyPayment: 0 }` when
      none is stored yet — without writing that default until `save` is called) and
      `save(key: CryptoKey, pref: DebtPlannerPreference): Promise<void>` (upserts via
      `putEncrypted`, following the `LiabilityRepository` pattern in
      `src/data/dexie/wealthRepository.ts`). Depends on T003, T004.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Generate a Payoff Plan (Priority: P1) 🎯 MVP

**Goal**: User picks avalanche or snowball and sees an ordered payoff plan with per-debt and
overall projected payoff dates, for their existing liabilities' minimum payments.

**Independent Test**: With ≥2 liabilities that have `interestRate` and `minimumPayment` set,
open the planner, select a strategy, and verify ordering and payoff dates are plausible
(per [quickstart.md](quickstart.md) Scenarios 1 and 2).

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they fail before writing the implementation.

- [x] T007 [P] [US1] Write failing unit tests in `tests/unit/debtPayoffEngine.test.ts` for
      `generateDebtPayoffPlan()`: avalanche ordering (highest `interestRate` first, ties
      broken by descending balance), snowball ordering (smallest `outstandingBalance` first,
      ties broken by descending `interestRate`), correct month-by-month interest accrual and
      payoff date for a minimum-payments-only plan (`extraMonthlyPayment: 0`) reconciled
      against a hand-built amortization table, and the `nonConverging` flag set when a
      liability's `minimumPayment` is less than its accruing monthly interest (FR-010).

### Implementation for User Story 1

- [x] T008 [P] [US1] Implement `partitionEligibleLiabilities(liabilities: Liability[]):
{ eligible: EligibleLiability[]; excludedLiabilityIds: string[] }` in
      `src/domain/debtPlanner/generatePlan.ts` — splits liabilities into those with both
      `interestRate` and `minimumPayment` set versus those missing either (FR-008).
- [x] T009 [US1] Implement `generateDebtPayoffPlan(input: GeneratePlanInput):
DebtPayoffPlan` in `src/domain/debtPlanner/generatePlan.ts` per
      [contracts/debt-payoff-engine.md](contracts/debt-payoff-engine.md) and
      [research.md](research.md) §1-2: strategy-based ordering, month-by-month simulation
      using integer basis-point interest accrual (`Math.round(balance * rateBasisPoints /
10000 / 12)`), a 600-month safety cap, and `nonConverging` flagging. Depends on T002,
      T008. Must make T007's tests pass.
- [x] T010 [US1] Create `src/pages/DebtPayoffPlannerPage.tsx`: load active liabilities via
      `LiabilityRepository.list()` and the saved preference via
      `DebtPlannerPreferenceRepository.get()`, render a strategy toggle (avalanche/
      snowball), call `generateDebtPayoffPlan()`, and display the ordered debt list with
      per-debt payoff dates, the overall payoff date and total interest, and a separate
      "needs interest rate / minimum payment" list built from `excludedLiabilityIds`
      (FR-008) that links to editing that liability on the existing Liabilities page.
      Depends on T006, T009.
- [x] T011 [US1] Add the route `liabilities/payoff-planner` (element
      `<DebtPayoffPlannerPage />`) inside the `<AppShell />` route block in `src/App.tsx`,
      and add a "Debt Payoff Planner" entry (a `lucide-react` icon such as `Landmark` or
      `TrendingDown`) to `NAV_ITEMS` in `src/components/AppShell.tsx`. Depends on T010.

**Checkpoint**: User Story 1 is fully functional and independently testable — a user with
existing liabilities can generate and view an avalanche or snowball plan.

---

## Phase 4: User Story 2 - Apply Extra Monthly Payment (Priority: P2)

**Goal**: User enters an extra monthly payment; the plan recalculates with the waterfall
reallocation (a paid-off debt's minimum rolls into the next debt), and the choice persists.

**Independent Test**: Enter an extra payment on an existing plan and verify the payoff date
moves earlier, interest decreases, and waterfall reallocation occurs once a debt clears (per
[quickstart.md](quickstart.md) Scenario 3).

### Tests for User Story 2 ⚠️

- [x] T012 [US2] Add failing unit test cases to `tests/unit/debtPayoffEngine.test.ts` (same
      file as T007 — sequential, not parallel) for `generateDebtPayoffPlan()` with a nonzero
      `extraMonthlyPayment`: the full extra amount is applied to the current
      highest-priority debt each month, and once a debt's balance reaches zero, its
      `minimumPayment` is added to the extra-payment pool for subsequent months — reconciled
      against a hand-built schedule.
      _(Done as part of T007 — the waterfall test case was written into the same file
      up front since it's the same engine design; see the "applies the full extra payment…"
      test.)_
- [x] T013 [P] [US2] Write integration test
      `tests/integration/debtPlannerPreferenceRepository.test.ts`: `get()` returns the
      documented default when nothing is stored, `save()` persists a strategy/
      extraMonthlyPayment change, and a subsequent `get()` returns the saved values.

### Implementation for User Story 2

- [x] T014 [US2] Close any gap T012 reveals in `generateDebtPayoffPlan()`'s waterfall
      handling in `src/domain/debtPlanner/generatePlan.ts` (T009's implementation is
      designed to already cover this — this task exists to fix, not rewrite, if a test
      fails). Depends on T012.
      _(No gap found — T007/T012's waterfall test passed against T009's implementation
      unmodified.)_
- [x] T015 [US2] Add an extra-monthly-payment input to `src/pages/DebtPayoffPlannerPage.tsx`:
      on change, recompute the plan immediately (target: under 1 second, per spec SC-004)
      and persist the new value via `DebtPlannerPreferenceRepository.save()`; on mount,
      initialize the field from the preference already loaded in T010. Depends on T010, T006.

**Checkpoint**: User Stories 1 and 2 both work independently — extra payments accelerate the
plan, apply the waterfall correctly, and persist across visits.

---

## Phase 5: User Story 3 - Compare Strategies (Priority: P3)

**Goal**: User sees avalanche and snowball compared side by side (months-to-debt-free, total
interest) at the same extra payment amount.

**Independent Test**: With an extra payment set, open the comparison view and verify both
strategies' figures match what generating each individually would show (per
[quickstart.md](quickstart.md) Scenario 4).

### Tests for User Story 3 ⚠️

- [x] T016 [P] [US3] Write failing unit test in `tests/unit/debtPayoffEngine.test.ts` for
      `compareStrategies()`: given the same liabilities and `extraMonthlyPayment`, it
      returns both an `avalanche` and a `snowball` plan matching two individual
      `generateDebtPayoffPlan()` calls.
      _(Done as part of T007 — see the "compareStrategies" describe block.)_

### Implementation for User Story 3

- [x] T017 [US3] Implement `compareStrategies(input: Omit<GeneratePlanInput, 'strategy'>):
{ avalanche: DebtPayoffPlan; snowball: DebtPayoffPlan }` in
      `src/domain/debtPlanner/generatePlan.ts` per
      [contracts/debt-payoff-engine.md](contracts/debt-payoff-engine.md) — calls
      `generateDebtPayoffPlan` twice, once per strategy. Depends on T009, T016.
      _(Done as part of T009's initial implementation — see `compareStrategies` at the
      bottom of `generatePlan.ts`.)_
- [x] T018 [US3] Add a comparison view to `src/pages/DebtPayoffPlannerPage.tsx` showing
      months-to-debt-free and total interest paid for both strategies side by side, backed
      by `compareStrategies()`. Depends on T015, T017.

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T019 [P] Write E2E test `tests/e2e/debtPayoffPlanner.spec.ts` covering
      [quickstart.md](quickstart.md) Scenarios 1-4 (avalanche plan, snowball plan, extra
      payment + waterfall, strategy comparison).
- [x] T020 [P] Manually run [quickstart.md](quickstart.md) Scenarios 5-6 (missing-data
      exclusion, non-converging warning) and confirm the UI messaging matches FR-008/FR-010.
      _(The interactive browser preview was stuck behind a stale single-instance lock from
      this session's own earlier navigations — not a bug in the feature — so both scenarios
      were instead verified via a second Playwright case in the same spec file, exercising
      real Chromium end-to-end exactly as a manual run would.)_
- [x] T021 Review all new code against Constitution Principle III (the domain engine in
      `src/domain/debtPlanner/` must import neither Dexie nor React) and Principle VI (no
      floating-point arithmetic anywhere in the money/rate calculations) before marking the
      feature complete.
      _(Confirmed: `generatePlan.ts`/`types.ts` import only `../entities` — no Dexie, no
      React; every arithmetic path uses `Math.round`/`Math.min`/`Math.max` on integers, with
      the one division inside `accrueMonthlyInterest` immediately rounded before it touches
      a balance; no `console.*` in any new file.)_

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational and on US1's `generatePlan.ts` (T009)
  and page (T010) existing — extends both rather than duplicating them.
- **User Story 3 (Phase 5)**: Depends on Foundational, US1's `generateDebtPayoffPlan` (T009),
  and US2's page state (T015) for the extra-payment amount used in the comparison.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each Phase

- Tests MUST be written and confirmed failing before the implementation task(s) that follow
  them (Constitution Principle IV).
- Within Foundational: T002, T003, T004 touch different files and can run in parallel; T005
  depends on T003; T006 depends on T003 and T004.
- Within US1: T007 and T008 can run in parallel (different files); T009 depends on both;
  T010 depends on T009 and T006; T011 depends on T010.
- Within US2: T012 is sequential after T007 (same file); T013 can run in parallel with T012
  (different file); T014 depends on T012; T015 depends on T010 and T006.
- Within US3: T016 can run any time after Foundational (different file from T012); T017
  depends on T009 and T016; T018 depends on T015 and T017.

### Parallel Opportunities

- Foundational: T002, T003, T004 together.
- US1: T007, T008 together.
- US2: T013 alongside T012 (different files).
- US3: T016 can be written in parallel with US2's tasks once Foundational is done, since it
  only touches the test file for a not-yet-written function.
- Polish: T019, T020 together.

---

## Parallel Example: Foundational Phase

```bash
Task: "Create src/domain/debtPlanner/types.ts with DebtPayoffPlan, DebtPayoffPlanEntry, etc."
Task: "Extend src/domain/entities.ts with Liability.interestRate/minimumPayment and DebtPlannerPreference"
Task: "Add debtPlannerPreferences table to src/data/dexie/db.ts"
```

## Parallel Example: User Story 1

```bash
Task: "Write failing unit tests in tests/unit/debtPayoffEngine.test.ts for ordering/simulation/nonConverging"
Task: "Implement partitionEligibleLiabilities() in src/domain/debtPlanner/generatePlan.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks everything else).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1, 2, and 5 independently.
5. This alone is a usable debt-visibility tool even before extra-payment planning exists.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → usable MVP (view a payoff order and dates).
3. User Story 2 → validate independently → users can accelerate their payoff plan.
4. User Story 3 → validate independently → users can compare strategies before committing.
5. Polish → E2E coverage and a final Constitution compliance pass.

## Notes

- [P] tasks touch different files with no unmet dependency.
- Every task in a user-story phase carries that story's label for traceability.
- Commit after each task or logical group; verify a test fails before implementing against
  it, and passes immediately after.
- `tests/unit/debtPayoffEngine.test.ts` is shared across US1/US2/US3 test tasks — later
  additions to it (T012, T016) are sequential with respect to each other and to T007, even
  though they may run in parallel with unrelated-file tasks from other stories.
