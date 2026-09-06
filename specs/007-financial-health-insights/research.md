# Phase 0 Research: Financial Health Insights

All items below were resolvable from the existing codebase and constitution; no external
research was required (no new dependency, no new storage, no new platform capability).

## 1. Data source for income/expense figures (FR-001, FR-007)

**Decision**: Reuse `incomeExpenseTrend(key, dateFrom, dateTo)` from
[`analyticsEngine.ts`](../../src/domain/analytics/analyticsEngine.ts) as-is. It already buckets
by month, already excludes `type === 'transfer'` transactions, and already sums into
`{ income, expense, netFlow }` per month.

**Rationale**: FR-007 requires this panel's figures to stay consistent with Analytics' own
totals — the only way to guarantee that permanently (not just at ship time) is to call the
same function, not reimplement the aggregation. This also means transfer exclusion (Edge Case
in spec.md) is inherited for free instead of re-implemented and re-tested.

**Alternatives considered**: A new query directly against `TransactionRepository`. Rejected —
duplicates logic that already exists and passed tests, and creates exactly the "independent/
divergent calculation" FR-007 prohibits.

## 2. Data source for budget adherence (FR-002, FR-007)

**Decision**: Reuse `budgetPerformance(key, dateFrom, dateTo)` from `analyticsEngine.ts`,
which returns one `{ budgetId, categoryId, periodStart, periodEnd, plannedAmount,
actualAmount }` row per budget period overlapping the range. "Within limit" is defined as
`actualAmount <= plannedAmount` — the exact comparison `AnalyticsPage.tsx` already uses for
its "Over budget" badge (`b.actualAmount > b.plannedAmount`), so the adherence percentage this
feature reports agrees with what a user already sees flagged red/not on the Analytics page.

**Rationale**: Same FR-007 reasoning as above; this is the "budgeting feature's own totals"
Acceptance Scenario 2 explicitly asks to match.

**Alternatives considered**: Re-deriving adherence from `BudgetItemRepository` rows directly.
Rejected for the same duplication reason.

## 3. Bucketing a yearly budget's single period into monthly trend points

**Decision**: A `BudgetPerformanceItem` is bucketed into the trend by
`periodStart.slice(0, 7)` (the month its period *starts* in). A monthly budget lands in
exactly its one month, as expected. A yearly budget (one item spanning Jan 1–Dec 31) is
counted only in January, not spread/prorated across all twelve months.

**Rationale**: The app has no existing precedent for prorating a yearly budget across months
anywhere (Analytics shows it as one row against its own `periodStart`); inventing a proration
rule here would itself be a new, untested piece of "divergent calculation logic" FR-007
warns against. Bucketing by start month is the simplest mapping that requires no new
assumption.

**Alternatives considered**: Spreading a yearly budget's planned/actual evenly across its 12
months. Rejected — fabricates numbers (a "monthly planned amount" the user never set) with no
existing UI precedent to match against.

## 4. What "the current period" means for Story 1's single-period card

**Decision**: Story 1's headline figures (savings rate, expense/income ratio, budget
adherence) are the **most recent month in the currently-selected range** — i.e., the last
point of the same trend array Story 2 renders — rather than a second, independently-selected
period.

**Rationale**: spec.md's Assumptions say period selection reuses "the same user-selectable
range controls" already used elsewhere (`DateRangeSelector`). One shared range control (as
Analytics already has) is simpler than two independent period pickers on one page, and every
acceptance scenario is satisfiable either way — Story 1's scenarios only require that *a*
period's figures are shown and correct, not that its selector be independent of Story 2's.

**Alternatives considered**: A separate single-month picker for Story 1 plus a separate range
picker for Story 2. Rejected as needless UI duplication for a single page — YAGNI given no
acceptance scenario asks for two independently-movable periods.

## 5. Composite score formula (FR-005, FR-006)

**Decision**: `score = round(0.6 × savingsRateComponent + 0.4 × budgetAdherenceComponent)`,
each component clamped to `[0, 100]`:
- `savingsRateComponent = clamp(savingsRate × 100, 0, 100)` (a negative savings rate floors
  at 0 rather than pulling the score negative)
- `budgetAdherenceComponent` = the adherence percentage itself (already 0–100)

If only one component is available (e.g. no active budgets → adherence is `null`), the score
uses that one component alone. If neither is available, the score itself is `null` ("not
enough data" per Acceptance Scenario 2 of Story 3), not a fabricated number.

Data quality is `'full'` only when **both** components are available **and** the trend has at
least `MIN_HEALTH_SCORE_PERIODS = 3` months with at least one income/expense transaction;
otherwise `'limited'`. `3` matches the existing minimum-sample-size convention already
established by `MIN_STREAK = 3` in
[`categorizationEngine.ts`](../../src/domain/categorization/categorizationEngine.ts) (spec
006) — enough to smooth one anomalous month without requiring a long history from a brand-new
user.

**Rationale**: spec.md's Assumptions explicitly state the exact weighting is an internal
design detail, not a requirement — the actual requirements (FR-005, FR-006, SC-004) only
constrain that it (a) is derived from the underlying metrics, (b) explains its contributing
factors, (c) moves in the correct direction when an input improves/worsens, and (d) flags
itself as limited-data rather than false-precision. The 60/40 weighting favors savings rate
slightly, since it directly reflects cash retained regardless of whether the user has set up
budgets at all, while still rewarding budget discipline.

**Alternatives considered**: An unweighted average, or a lookup-table rating (A–F). Rejected
in favor of the simplest formula that satisfies SC-004's directional-movement test — a
lookup table would need its own boundary-case tests for no added requirement coverage.

## 6. Route and navigation placement

**Decision**: New route `/financial-health`, new page `FinancialHealthPage.tsx`, one new
`AppShell.tsx` nav item placed between "Net Worth" and "Analytics" (the two existing
derived/reporting views it sits conceptually between).

**Rationale**: Matches this app's existing kebab-case route convention (`/net-worth`,
`/savings-goals`); placing the nav item alongside the other two reporting views groups
related destinations together. The sidebar is present on every page, so this single nav
item already satisfies SC-002's "within 2 taps/clicks from the dashboard" (dashboard → click
nav item = 1 click) without needing a dedicated dashboard card — adding one anyway would be
scope beyond what any requirement asks for.

**Alternatives considered**: `/insights` or `/health-score`. Rejected as less specific/more
generic than the feature's actual name; a dedicated Dashboard summary card. Rejected as
unrequested scope (no FR or SC asks for a dashboard-embedded view, only "reachable within 2
clicks", which the nav item alone already satisfies).

## 7. New persisted entity?

**Decision**: None. Confirmed against spec.md's own Key Entities section ("Financial Health
Snapshot (derived, not independently persisted)") — no new Dexie table, no schema version
bump.

**Rationale**: Every figure is recomputed on demand from already-persisted ledger/budget
data; persisting a snapshot would itself become a second, potentially-stale source of truth
that could drift from FR-007's single-source requirement.
