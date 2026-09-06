---
description: 'Task list template for feature implementation'
---

# Tasks: Savings Goals

**Input**: Design documents from `/specs/003-savings-goals/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/goal-progress-engine.md](contracts/goal-progress-engine.md),
[quickstart.md](quickstart.md)

**Tests**: Included and REQUIRED, not optional. Constitution Principle IV mandates test-first
development for money-affecting logic; the plan's Constitution Check holds this engine to
that same bar, following the precedent already set in
[../002-debt-payoff-planner/plan.md](../002-debt-payoff-planner/plan.md).

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3) so each story
can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths below are real paths in this repository, matching existing conventions (see
  `src/data/dexie/wealthRepository.ts` for the repository pattern and
  `src/domain/debtPlanner/generatePlan.ts` for the pure-engine pattern this feature mirrors)

---

## Phase 1: Setup

**Purpose**: Establish a clean baseline before touching any code

- [x] T001 Confirm no new npm dependency is required (per [research.md](research.md) §6) and
      run the existing test suite (`npm run test`) to confirm it passes cleanly before
      starting, establishing a clean baseline to diff against.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared date math, entity fields, and storage that every user story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Extract `addMonthsISO()` and a new `monthsBetween()` helper out of
      `src/domain/debtPlanner/generatePlan.ts` into a new
      `src/domain/shared/dateMath.ts` module (per [research.md](research.md) §2), and update
      `generatePlan.ts` to import `addMonthsISO` from it instead of keeping its own private
      copy. This MUST NOT change `generatePlan.ts`'s behavior — re-run
      `tests/unit/debtPayoffEngine.test.ts` after this change and confirm all cases still
      pass unmodified.
- [x] T003 [P] Add `SavingsGoal` and `GoalContribution` interfaces to
      `src/domain/entities.ts` per [data-model.md](data-model.md) (`SavingsGoal`: `id`,
      `name`, `targetAmount`, `targetDate: ISODateString | null`, `deletedAt`, `createdAt`,
      `updatedAt`; `GoalContribution`: `id`, `goalId`, `amount`, `date: ISODateString`,
      `createdAt`, `updatedAt` — no `deletedAt`, per research.md §3).
- [x] T004 [P] Add `savingsGoals` and `goalContributions` encrypted tables to
      `src/data/dexie/db.ts`: `SavingsGoalRow extends EncryptedRow { deletedAt: number }`,
      `GoalContributionRow extends EncryptedRow { goalId: string; date: string }`, add both
      properties to `MyFinDatabase`, and bump to
      `this.version(3).stores({ savingsGoals: 'id, deletedAt', goalContributions: 'id, goalId, date' })`
      (additive-only per Dexie's versioning model; do not modify the `version(1)`/`version(2)`
      blocks).
- [x] T005 [P] Create `src/domain/savingsGoals/types.ts` defining `GoalStatus` (`'achieved' |
'insufficient-data' | 'behind' | 'on-track'`) and `GoalProgress` (`goalId`,
      `savedAmount`, `progressPercent`, `achieved`, `projectedCompletionDate: string | null`,
      `status: GoalStatus`) per [data-model.md](data-model.md).

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Create and Track a Savings Goal (Priority: P1) 🎯 MVP

**Goal**: User creates a goal, logs contributions, sees saved amount/progress, and is told
when a goal is achieved; editing and (soft-)deleting a goal both work.

**Independent Test**: Create a goal, log two contributions, and verify the displayed
progress (amount saved and percentage) matches the sum of the logged contributions (per
[quickstart.md](quickstart.md) Scenario 1).

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they fail before writing the implementation.

- [x] T006 [P] [US1] Write failing unit tests in `tests/unit/goalProgressEngine.test.ts` for
      `computeGoalProgress()` covering: `savedAmount` as the sum of contributions (including
      a negative correction, per research.md §3), the `achieved` flag (including overshoot
      above 100%), `insufficient-data` status for fewer than two contributions and for a
      zero-month contribution span, the projection formula from research.md §1 for a
      concrete two-contribution example, and `behind`/`on-track` classification against a
      target date (FR-005/FR-006) — i.e. cover this engine's full contract in one pass, the
      same way `debtPayoffEngine.test.ts` did for spec 002.
- [x] T007 [P] [US1] Write failing integration tests in
      `tests/integration/savingsGoalRepositories.test.ts` for `SavingsGoalRepository`
      (create/update/list/softDelete/restore) and `GoalContributionRepository` (`create`
      rejects a future-dated contribution and a zero-amount contribution per FR-009; `remove`;
      `listForGoal`), and confirm a restored goal's prior contributions are immediately
      visible again via `listForGoal` (research.md §4).

### Implementation for User Story 1

- [x] T008 [US1] Implement `SavingsGoalRepository` and `GoalContributionRepository` in
      `src/data/dexie/savingsGoalRepository.ts` per
      [contracts/goal-progress-engine.md](contracts/goal-progress-engine.md), following the
      `LiabilityRepository` pattern in `src/data/dexie/wealthRepository.ts`. Depends on T003,
      T004. Must make T007's tests pass.
- [x] T009 [US1] Implement `computeGoalProgress(input: ComputeGoalProgressInput):
GoalProgress` in `src/domain/savingsGoals/goalProgress.ts` per
      [contracts/goal-progress-engine.md](contracts/goal-progress-engine.md) and
      [research.md](research.md) §1/§5, using `monthsBetween`/`addMonthsISO` from
      `src/domain/shared/dateMath.ts` (T002). Depends on T002, T005. Must make T006's tests
      pass.
- [x] T010 [US1] Create `src/pages/SavingsGoalsPage.tsx`: a goal list (one Card per goal)
      with a create/edit dialog (name, target amount, optional target date — the same dialog
      serves both create and edit, pre-filled when editing, per FR-007), each goal card
      showing saved-vs-target amount, progress percentage, and an achieved badge when
      `computeGoalProgress().achieved` is true (no projection/status display yet — that's
      Story 2); an "Add contribution" dialog per goal (amount, date) that calls
      `GoalContributionRepository.create`; a small list of that goal's logged contributions
      with a remove action calling `GoalContributionRepository.remove`; and a delete-goal
      action calling `SavingsGoalRepository.softDelete`. Depends on T008, T009.
- [x] T011 [US1] Add the route `savings-goals` (element `<SavingsGoalsPage />`) inside the
      `<AppShell />` route block in `src/App.tsx`, and add a "Savings Goals" nav entry (a
      `lucide-react` icon such as `Target` or `PiggyBank`) to `NAV_ITEMS` in
      `src/components/AppShell.tsx`. Depends on T010.
- [x] T012 [US1] Add a "Savings Goals" section to `src/pages/TrashPage.tsx` — list
      soft-deleted goals (via `db.savingsGoals.filter((r) => r.deletedAt !== NOT_DELETED)`)
      with a Restore action calling `SavingsGoalRepository.restore`, mirroring the existing
      Accounts/Transactions sections on that page, so FR-007's "recoverable" requirement is
      reachable in the UI. Depends on T008.

**Checkpoint**: User Story 1 is fully functional and independently testable — a user can
create a goal, log/remove contributions, edit or delete/restore it, and see accurate
progress.

---

## Phase 4: User Story 2 - Projected Completion Date (Priority: P2)

**Goal**: User sees a projected completion date once a goal has enough contribution history,
and a visible flag when that projection falls behind the goal's target date.

**Independent Test**: Log contributions for a goal spaced roughly a month apart, then verify
the shown projected completion date is consistent with dividing the remaining amount by the
observed average monthly contribution (per [quickstart.md](quickstart.md) Scenario 2).

### Tests for User Story 2 ⚠️

- [x] T013 [US2] _(Done as part of T006 — the projection-formula and
      behind/on-track/insufficient-data test cases were written into the same file up front,
      since `computeGoalProgress()` is one small pure function covering both stories at
      once.)_

### Implementation for User Story 2

- [x] T014 [US2] Add the projected completion date and a status badge
      (`behind`/`on-track`/`insufficient-data`) to each unachieved goal's card in
      `src/pages/SavingsGoalsPage.tsx`, reading `projectedCompletionDate`/`status` from the
      same `computeGoalProgress()` result T010 already computes. Depends on T010, T009.

**Checkpoint**: User Stories 1 and 2 both work — projections and behind-schedule flags are
visible per goal.

---

## Phase 5: User Story 3 - Goals Overview (Priority: P3)

**Goal**: User sees, at a glance, total saved across all goals alongside each goal's status.

**Independent Test**: With three goals in different states (on-track, behind, achieved),
verify each is categorized correctly and the total saved figure matches the sum of all
goals' saved amounts (per [quickstart.md](quickstart.md) Scenario 3).

### Implementation for User Story 3

- [x] T015 [US3] Add a "Total saved across goals" summary header to
      `src/pages/SavingsGoalsPage.tsx`, summing each listed goal's `savedAmount` from
      `computeGoalProgress()` (per FR-008; no new domain function needed — this is a direct
      sum of already-validated figures, not a separate money-affecting calculation). Depends
      on T014.

**Checkpoint**: All three user stories are independently functional on one page.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T016 [P] Write E2E test `tests/e2e/savingsGoals.spec.ts` covering
      [quickstart.md](quickstart.md) Scenarios 1-3 and 6 (create/contribute/achieve,
      projection + behind-schedule, overview totals, delete/restore).
- [x] T017 [P] Verify [quickstart.md](quickstart.md) Scenarios 4-5 (future-dated
      contribution rejection, stalled/negative-rate → no projection) against the actual UI
      messaging — these are already exercised at the engine/repository level by T006/T007;
      this task confirms the on-screen wording matches FR-009 and research.md §1.
- [x] T018 Review all new code against Constitution Principle III (`src/domain/savingsGoals/`
      and `src/domain/shared/` must import neither Dexie nor React) and Principle VI (every
      monetary field stays integer; no `console.*` in any new file) before marking the
      feature complete.
      _(Confirmed: `goalProgress.ts` imports only `../shared/dateMath` and `./types`;
      `types.ts` and `dateMath.ts` import nothing; `progressPercent` is `Math.round`ed,
      `monthsToGo` is `Math.ceil`ed against an `Math.max(0, ...)`-clamped integer remainder —
      no floating-point value is ever returned or stored; no `console.*` in any new file.)_

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational and on US1's engine (T009) and page
  (T010) — extends both rather than duplicating them.
- **User Story 3 (Phase 5)**: Depends on US2's page state (T014) for the per-goal figures it
  sums.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each Phase

- Tests MUST be written and confirmed failing before the implementation task(s) that follow
  them (Constitution Principle IV).
- Within Foundational: T002, T003, T004, T005 touch different files and can all run in
  parallel.
- Within US1: T006 and T007 can run in parallel (different files); T008 depends on T003/T004;
  T009 depends on T002/T005; T010 depends on T008/T009; T011 and T012 both depend on T010/T008
  respectively and can run in parallel with each other.
- US2's T014 and US3's T015 are sequential edits to the same file
  (`SavingsGoalsPage.tsx`), each depending on the previous.

### Parallel Opportunities

- Foundational: T002, T003, T004, T005 together.
- US1: T006, T007 together; later, T011 alongside T012.
- Polish: T016, T017 together.

---

## Parallel Example: Foundational Phase

```bash
Task: "Extract addMonthsISO()/monthsBetween() into src/domain/shared/dateMath.ts"
Task: "Add SavingsGoal/GoalContribution to src/domain/entities.ts"
Task: "Add savingsGoals/goalContributions tables to src/data/dexie/db.ts"
Task: "Create src/domain/savingsGoals/types.ts"
```

## Parallel Example: User Story 1

```bash
Task: "Write failing unit tests in tests/unit/goalProgressEngine.test.ts"
Task: "Write failing integration tests in tests/integration/savingsGoalRepositories.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks everything else).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run quickstart.md Scenario 1 (and the overshoot/delete/restore
   parts of Scenarios 1 and 6) independently.
5. This alone is a usable goal-tracking tool even before projections or the overview exist.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → usable MVP (create goals, log contributions, see
   progress and achieved status).
3. User Story 2 → validate independently → users see a projected completion date and
   behind-schedule flag.
4. User Story 3 → validate independently → users see a combined total across all goals.
5. Polish → E2E coverage and a final Constitution compliance pass.

## Notes

- [P] tasks touch different files with no unmet dependency.
- Every task in a user-story phase carries that story's label for traceability.
- Commit after each task or logical group; verify a test fails before implementing against
  it, and passes immediately after.
- T002's `dateMath.ts` extraction touches spec 002's already-shipped code — re-running its
  existing test suite is the safety net, not a rewrite.
