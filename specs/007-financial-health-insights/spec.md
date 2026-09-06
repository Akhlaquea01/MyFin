# Feature Specification: Financial Health Insights

**Feature Branch**: `007-financial-health-insights`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "Financial health score / insights panel — a derived analytics
view (savings rate, expense-to-income ratio, budget adherence trend) computed entirely from
existing ledger data — no new data source needed."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - View Core Financial Health Metrics (Priority: P1)

A user opens an insights panel and sees a small set of key figures about their financial
health for a selected period: savings rate, expense-to-income ratio, and budget adherence,
computed from their existing ledger and budget data.

**Why this priority**: These three figures are the core deliverable — everything else in
this feature builds on having them displayed correctly first.

**Independent Test**: With known income/expense transactions and an active budget for a
period, open the insights panel and verify each figure matches manual calculation from the
underlying data (savings rate = (income − expense) / income; expense-to-income ratio =
expense / income; budget adherence = actual vs. planned across active budgets).

**Acceptance Scenarios**:

1. **Given** income and expense transactions exist for the selected period, **When** the
   user opens the insights panel, **Then** savings rate and expense-to-income ratio are
   shown and match manual computation from those transactions.
2. **Given** active budgets exist for the selected period, **When** the user views the
   panel, **Then** an overall budget adherence figure (e.g., % of budgets within their
   limit) is shown, matching the budgeting feature's own totals.
3. **Given** a period with no income recorded, **When** the user views the panel, **Then**
   the savings rate and expense-to-income ratio are shown as undefined/not applicable rather
   than a divide-by-zero error or misleading value.

---

### User Story 2 - Trend Over Time (Priority: P2)

A user views how their savings rate and budget adherence have trended over recent periods
(e.g., the last 6 months), to see whether their financial habits are improving or slipping.

**Why this priority**: Turns single-period snapshots into a trend line, which is more
actionable, but depends on Story 1's figures already being computed correctly per period.

**Independent Test**: With several months of historical transactions and budgets, view the
trend chart and verify each period's plotted value matches what Story 1 would show if that
period were selected individually.

**Acceptance Scenarios**:

1. **Given** multiple past periods of ledger and budget data, **When** the user views the
   trend view, **Then** savings rate and budget adherence are plotted per period and match
   the single-period figures for each.
2. **Given** a user-selectable time range, **When** the range is changed, **Then** the trend
   view updates to show only the selected periods.

---

### User Story 3 - Composite Health Score (Priority: P3)

A user sees a single overall "financial health score" (e.g., a 0–100 figure or a
qualitative rating) that summarizes the underlying metrics at a glance.

**Why this priority**: A single-number summary is a nice-to-have layer of abstraction over
Stories 1 and 2's already-meaningful figures; some users may find it motivating, but it adds
interpretive risk (a single number can oversimplify) so it is lower priority than the raw
figures.

**Independent Test**: With a known set of underlying metrics, verify the displayed score
changes in the expected direction (up or down) when one input metric is deliberately
improved or worsened, and that the score's contributing factors are explained, not just the
number alone.

**Acceptance Scenarios**:

1. **Given** the underlying metrics from Story 1, **When** the user views the panel,
   **Then** a single composite score/rating is shown alongside a breakdown of which
   underlying metrics contributed positively or negatively.
2. **Given** the user does not have enough data yet (e.g., first month of use, no budgets
   set), **When** they view the panel, **Then** the score indicates it is based on limited
   data rather than presenting a falsely precise figure.

---

### Edge Cases

- What happens when there are no transactions at all for the selected period? The panel
  shows a clear "not enough data" state rather than zeros that could be misread as "perfect"
  or "zero spending."
- What happens when income is negative or zero for a period (e.g., a loss-making month via
  refunds/adjustments)? Ratios that would divide by zero or produce a negative/undefined
  result must be shown as not applicable, not a computed but nonsensical number.
- What happens when no budgets are active for a period? Budget adherence is omitted or shown
  as not applicable, and the composite score (Story 3) must not silently penalize the user
  for a metric it cannot compute.
- What happens when transfers between the user's own accounts are included in the
  calculation? They must be excluded from income/expense figures, consistent with the
  existing ledger's treatment of transfers (FR-011 in the core spec).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST compute and display, for a user-selectable period, a savings rate
  ((income − expense) / income) and an expense-to-income ratio, derived solely from existing
  transaction data, excluding transfers.
- **FR-002**: System MUST compute and display a budget adherence figure for the selected
  period, derived from existing budget actual-vs-planned data.
- **FR-003**: System MUST display each ratio-based metric as "not applicable" rather than a
  computed value when its calculation would require dividing by zero or negative income.
- **FR-004**: System MUST display a trend of savings rate and budget adherence across a
  user-selectable range of recent periods.
- **FR-005**: System MUST compute and display a single composite financial health score/
  rating derived from the underlying metrics, along with a breakdown of which metrics
  contributed to it.
- **FR-006**: System MUST indicate when the composite score is based on limited or
  incomplete data (e.g., fewer than a defined minimum number of periods, or no active
  budgets) rather than presenting it with false precision.
- **FR-007**: All figures on this panel MUST remain consistent with the equivalent totals
  already shown by the dashboard, budgeting, and analytics features (no independent/
  divergent calculation logic).

### Key Entities

- **Financial Health Snapshot** (derived, not independently persisted): the set of computed
  metrics (savings rate, expense-to-income ratio, budget adherence, composite score) for a
  given period, always recalculated from current ledger/budget data rather than stored as a
  separate source of truth.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Every metric on the insights panel matches a manual recomputation from the
  underlying ledger/budget data to 100% accuracy, for any selected period.
- **SC-002**: A user can view their current financial health metrics and trend within 2
  taps/clicks from the dashboard.
- **SC-003**: Zero instances of a divide-by-zero, negative-percentage, or otherwise
  nonsensical figure are shown across representative test scenarios (no income, no budgets,
  first month of use).
- **SC-004**: A user changing one underlying metric (e.g., reducing spending in a test
  scenario) sees the composite score move in the correct direction 100% of the time.

## Assumptions

- This feature introduces no new user-entered data — it is a read-only, derived view over
  data already captured by the core ledger, budgeting, and analytics features.
- The composite score's exact weighting formula is an internal design detail; the
  requirement here is that it moves directionally correctly and explains its contributing
  factors, not a specific formula.
- "Period" defaults to the same monthly granularity already used elsewhere in the app
  (budgets, analytics), with the same user-selectable range controls.
