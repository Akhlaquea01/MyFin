---
description: 'Task list template for feature implementation'
---

# Tasks: Financial Health Insights

**Input**: Design documents from `/specs/007-financial-health-insights/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md),
[contracts/financial-health-engine.md](contracts/financial-health-engine.md),
[quickstart.md](quickstart.md)

**Tests**: Included. Not one of Constitution Principle IV's four named engines, but held to
its bar per the precedent already set for specs 002-004/006 (plan.md's Constitution Check) —
the pure functions in `financialHealthEngine.ts` and the read-only orchestrator in
`financialHealthService.ts` get unit + integration tests before being considered done.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3). All three
stories share one `getFinancialHealthTrend()` orchestrator built in Foundational: US1 reads
only its last element, US2 renders the whole array, US3 derives a score from it. This keeps
each story independently testable/shippable without forward-referencing a story that hasn't
landed yet.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths below are real paths in this repository, following the conventions in
  `src/domain/categorization/categorizationEngine.ts` (pure-engine + thin-orchestrator split,
  spec 006) and `src/pages/AnalyticsPage.tsx` (the `DateRangeSelector` + Chart.js pattern this
  feature's page reuses).

---

## Phase 1: Setup

**Purpose**: Establish a clean baseline before touching any code

- [X] T001 Confirm no new npm dependency is required (plan.md's Technical Context — reuses
      Chart.js, already a dependency via `AnalyticsPage.tsx`, plus the existing
      `incomeExpenseTrend`/`budgetPerformance` functions) and run `npm run test` to confirm the
      suite passes cleanly before starting, establishing a baseline to diff against.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared types, pure math, and read-only orchestrator every story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Add `FinancialHealthMetrics` and `FinancialHealthScore` types (plus the
      `MIN_HEALTH_SCORE_PERIODS = 3` constant) to
      `src/domain/analytics/financialHealthEngine.ts` per [data-model.md](data-model.md):
      `FinancialHealthMetrics { month, income, expense, savingsRate: number | null,
      expenseToIncomeRatio: number | null, budgetAdherence: number | null, budgetsConsidered:
      number }`; `FinancialHealthScore { score: number | null, dataQuality: 'full' |
      'limited', breakdown: { savingsRate: {value, component, weight}, budgetAdherence:
      {value, component, weight} } }`.
- [X] T003 [P] Write failing unit tests in `tests/unit/financialHealthEngine.test.ts` for
      `computeSavingsRate`/`computeExpenseToIncomeRatio` (both `null` when `income <= 0`,
      matching values otherwise), `computeBudgetAdherence` (empty array → `{ adherence: null,
      considered: 0 }`; a mix of within-limit/over-limit items → correct percentage using the
      same `actualAmount <= plannedAmount` comparison `AnalyticsPage.tsx` uses for its "Over
      budget" badge), and `buildMonthlyMetrics` (composes the three into one
      `FinancialHealthMetrics`, `month` filled in by the caller) — per
      [contracts/financial-health-engine.md](contracts/financial-health-engine.md). Depends on
      T002 (needs the types to compile against).
- [X] T004 Implement `computeSavingsRate`, `computeExpenseToIncomeRatio`,
      `computeBudgetAdherence`, `buildMonthlyMetrics` in
      `src/domain/analytics/financialHealthEngine.ts` per
      [contracts/financial-health-engine.md](contracts/financial-health-engine.md) — pure, no
      I/O, no `CryptoKey`. Must make T003's tests pass. Depends on T002, T003.
- [X] T005 Implement `getFinancialHealthTrend(key, dateFrom, dateTo)` in
      `src/domain/analytics/financialHealthService.ts`: calls the *existing*
      `incomeExpenseTrend` and `budgetPerformance` from
      `src/domain/analytics/analyticsEngine.ts` (no new Dexie query — research.md §1-2);
      groups the `budgetPerformance` rows by `periodStart.slice(0, 7)` (research.md §3); for
      every month present in `incomeExpenseTrend`'s result, calls `buildMonthlyMetrics` with
      that month's income/expense and its bucketed budget rows (empty array if none), filling
      in `month`. Returns the resulting `FinancialHealthMetrics[]`, ascending by month.
      Depends on T004.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - View Core Financial Health Metrics (Priority: P1) 🎯 MVP

**Goal**: A user opens an insights panel and sees savings rate, expense-to-income ratio, and
budget adherence for the most recent period in the selected range, matching manual
computation and the existing Analytics/Budgets totals exactly.

**Independent Test**: With known income/expense transactions and an active budget for a
period, open the insights panel and verify each figure matches manual calculation (per
[quickstart.md](quickstart.md) Scenarios 1, 2, 3).

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they fail before writing the implementation.

- [X] T006 [P] [US1] Write failing integration tests in
      `tests/integration/financialHealthService.test.ts` for `getFinancialHealthTrend`: seeded
      income/expense transactions plus one within-limit and one over-limit budget for a month
      produce a last point matching manual computation (savings rate, expense/income ratio,
      50% budget adherence — quickstart Scenario 1); a month with only expense transactions
      (no income) produces `savingsRate`/`expenseToIncomeRatio: null` (quickstart Scenario 2);
      a month with no budgets produces `budgetAdherence: null` and `budgetsConsidered: 0`
      (quickstart Scenario 3).

### Implementation for User Story 1

- [X] T007 [US1] Create `src/pages/FinancialHealthPage.tsx`: a `DateRangeSelector` (defaulting
      to "Last 6 months", matching `AnalyticsPage.tsx`'s `defaultRange()`) driving a call to
      `getFinancialHealthTrend`; three cards (Savings Rate, Expense-to-Income Ratio, Budget
      Adherence) reading `trend[trend.length - 1]`, each rendering "Not applicable" when its
      value is `null` rather than `0%` (FR-003); an empty state when `trend.length === 0`
      (Edge Cases — "not enough data", never a bare zero). Depends on T005. Must satisfy T006's
      scenarios when driven through the UI.
- [X] T008 [US1] Register the new page: add
      `<Route path="financial-health" element={<FinancialHealthPage />} />` in `src/App.tsx`
      and a nav entry `{ to: '/financial-health', label: 'Financial Health', icon: HeartPulse
      }` (import `HeartPulse` from `lucide-react`) in `src/components/AppShell.tsx`'s
      `NAV_ITEMS`, placed between the `/net-worth` and `/analytics` entries (research.md §6).
      Depends on T007. Satisfies SC-002 (reachable in 1 click from anywhere, including the
      Dashboard).

**Checkpoint**: User Story 1 is fully functional and independently testable — the panel is
reachable, and its three headline figures are correct including the zero-income and
zero-budget edge cases.

---

## Phase 4: User Story 2 - Trend Over Time (Priority: P2)

**Goal**: A user views how savings rate and budget adherence have trended over recent months,
using the same range control as Story 1.

**Independent Test**: With several months of historical transactions and budgets, view the
trend chart and verify each period's plotted value matches what Story 1 shows for that month
individually (per [quickstart.md](quickstart.md) Scenario 4).

### Tests for User Story 2 ⚠️

- [X] T009 [P] [US2] Extend `tests/integration/financialHealthService.test.ts`: seed 3+
      consecutive months of transactions/budgets and verify `getFinancialHealthTrend` returns
      one point per month, sorted ascending, and that each point's figures match what T006's
      single-month assertions would produce if that month were the latest one queried
      (quickstart Scenario 4).

### Implementation for User Story 2

- [X] T010 [US2] Extend `src/pages/FinancialHealthPage.tsx`: add a line chart (reusing the
      `ChartCanvas`/Chart.js config pattern from `src/pages/AnalyticsPage.tsx`) plotting
      `savingsRate` and `budgetAdherence` per month across the full `trend` array; changing the
      `DateRangeSelector` range re-fetches `getFinancialHealthTrend` and re-renders only the
      selected months (Acceptance Scenario 2). Depends on T007, T009.

**Checkpoint**: User Stories 1 and 2 both work independently — the single-period cards and the
multi-month trend chart agree with each other and with Analytics.

---

## Phase 5: User Story 3 - Composite Health Score (Priority: P3)

**Goal**: A user sees a single 0–100 composite score with a breakdown of contributing metrics,
clearly marked when based on limited data.

**Independent Test**: With a known set of underlying metrics, verify the score moves in the
expected direction when an input metric is deliberately improved or worsened, and that a
brand-new profile with little data shows a "limited data" indicator rather than a falsely
precise number (per [quickstart.md](quickstart.md) Scenarios 5, 6).

### Tests for User Story 3 ⚠️

- [X] T011 [P] [US3] Write failing unit tests in `tests/unit/financialHealthEngine.test.ts`
      for `computeFinancialHealthScore` per
      [contracts/financial-health-engine.md](contracts/financial-health-engine.md): 60/40
      weighting when both components are present; the sole available component used
      unweighted when only one is present; `score: null` when both are `null`;
      `dataQuality: 'full'` only when both components are non-null AND at least 3 points in
      the trend have `income > 0`, `'limited'` otherwise; the exact empty-`trend` default
      shape.

### Implementation for User Story 3

- [X] T012 [US3] Implement `computeFinancialHealthScore(trend)` in
      `src/domain/analytics/financialHealthEngine.ts` per
      [contracts/financial-health-engine.md](contracts/financial-health-engine.md) — pure, no
      I/O. Must make T011's tests pass. Depends on T004, T011.
- [X] T013 [US3] Implement `getFinancialHealthScore(key, dateFrom, dateTo)` in
      `src/domain/analytics/financialHealthService.ts`: calls `getFinancialHealthTrend` then
      `computeFinancialHealthScore` — no independent query path. Depends on T005, T012.
- [X] T014 [US3] Extend `src/pages/FinancialHealthPage.tsx`: a composite score card showing
      `score` (or "Not enough data yet" when `null`), a breakdown of the savings-rate and
      budget-adherence components with their weights (FR-005, Acceptance Scenario 1), and a
      visible "based on limited data" notice when `dataQuality === 'limited'` (FR-006).
      Depends on T007, T013.

**Checkpoint**: All three user stories are independently functional — headline figures, trend
chart, and composite score all work end-to-end and agree with each other.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T015 [P] Write E2E test `tests/e2e/financialHealthInsights.spec.ts` covering
      [quickstart.md](quickstart.md) Scenarios 1, 4, and 5 end-to-end through the actual nav
      item and page.
- [X] T016 Review all new code against Constitution Principle III (`financialHealthEngine.ts`
      has zero repository/Dexie imports; `financialHealthService.ts` calls only
      `analyticsEngine.ts`'s existing functions, never Dexie directly;
      `FinancialHealthPage.tsx` never imports Dexie) and confirm FR-007 in practice by
      grepping this feature's files for any independent transaction/budget query — there
      should be none outside `incomeExpenseTrend`/`budgetPerformance` — before marking the
      feature complete. Also confirm no backup/schema change was introduced (this feature
      persists nothing new — data-model.md, research.md §7), i.e. `src/data/io/backupService.ts`
      and `src/data/dexie/db.ts`'s version count are untouched by this feature's diff.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational, and on US1's `FinancialHealthPage.tsx`
  shell (T007) which it extends — not on US1's route/nav task (T008).
- **User Story 3 (Phase 5)**: Depends on Foundational, and on US1's `FinancialHealthPage.tsx`
  shell (T007) which it extends — independent of US2's chart (T010).
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each Phase

- Tests MUST be written and confirmed failing before the implementation task(s) that follow
  them.
- Foundational: T002 must land before T003 (tests need the types); T004 implements against
  T003; T005 depends on T004.
- US1: T006 is written against T005's contract before T007 implements the page; T008 (route/
  nav) depends only on T007 existing.
- US2: T009 extends T006's test file; T010 depends on T007 (the page shell) and T009.
- US3: T011 can be written as soon as T002's types exist, in parallel with US1/US2 work, but
  physically depends on T004 to actually run against; T012 depends on T004 and T011; T013
  depends on T005 and T012; T014 depends on T007 and T013.
- Polish: T015 and T016 can run in parallel once all stories are complete.

### Parallel Opportunities

- Foundational: T002 and T003 can be drafted in parallel once T002's types exist (T003 needs
  them to compile against, so T002 lands first; both still land well before T004).
- US1: T006 has no other US1 task to run alongside.
- US2/US3: T009 and T011 touch different files and have no dependency on each other — can
  proceed in parallel.
- Polish: T015, T016 together.

---

## Parallel Example: Foundational Phase

```bash
Task: "Add FinancialHealthMetrics/FinancialHealthScore types to src/domain/analytics/financialHealthEngine.ts"
Task: "Write failing unit tests in tests/unit/financialHealthEngine.test.ts"
```

## Parallel Example: User Story 2 vs. User Story 3

```bash
Task: "Extend tests/integration/financialHealthService.test.ts with multi-month trend assertions"
Task: "Write failing unit tests for computeFinancialHealthScore in tests/unit/financialHealthEngine.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks everything else).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1, 2, and 3 independently.
5. This alone delivers the spec's core, most load-bearing value — correct, Analytics-
   consistent headline figures, reachable in one click — before any trend or scoring layer is
   added.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → headline figures fully correct (MVP!).
3. User Story 2 → validate independently → trend chart layers on top without changing US1's
   figures.
4. User Story 3 → validate independently → composite score layers on top of the same trend
   data US2 already renders.
5. Polish → E2E coverage and a final Constitution/FR-007 compliance pass.

## Notes

- [P] tasks touch different files with no unmet dependency.
- Every task in a user-story phase carries that story's label for traceability.
- Commit after each task or logical group; verify a test fails before implementing against
  it, and passes immediately after.
- This feature introduces no new Dexie table, no schema version bump, and no backup changes —
  T016 exists specifically to confirm that stayed true, since it's easy for an implementation
  to accidentally reach for a "cache" table that would violate research.md §7.
