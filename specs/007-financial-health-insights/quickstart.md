# Quickstart: Financial Health Insights

## Prerequisites

- Dev server running: `npm run dev`
- An onboarded profile (PIN set) with at least one account
- Node/Vitest available for the unit-test scenarios below (`npm run test`)

## Scenario 1 — Core metrics match manual computation (Story 1, SC-001, SC-003)

1. Create an account with opening balance 0.
2. Record an income transaction: +₹50,000 this month, category "Salary".
3. Record two expense transactions this month totaling ₹20,000, split across any category.
4. Create a budget for one category with a planned amount above its actual spend this month
   (so it's "within limit"), and a second budget for a different category with a planned
   amount below its actual spend (so it's "over budget").
5. Navigate to **Financial Health** (sidebar, between Net Worth and Analytics — 1 click from
   Dashboard, satisfying SC-002).
6. **Expected**:
   - Savings rate shown = `(50000 − 20000) / 50000` = 60%.
   - Expense-to-income ratio shown = `20000 / 50000` = 40%.
   - Budget adherence shown = 50% (1 of 2 budgets within limit) — cross-check this figure
     against the same two budgets' rows on the existing **Analytics** page's "Budget
     performance" card; the over/under flag there must agree with which budget dragged
     adherence down here (FR-007).

## Scenario 2 — No income this period (Story 1, Edge Case, SC-003)

1. For a month with only expense transactions (no income), open Financial Health for that
   period.
2. **Expected**: savings rate and expense-to-income ratio both show "Not applicable" — never
   `0%`, `Infinity%`, or a negative percentage.

## Scenario 3 — No active budgets (Story 1, Edge Case)

1. Delete/archive all budgets, or use a fresh profile with none created.
2. Open Financial Health.
3. **Expected**: budget adherence shows "Not applicable" (not `0%`), and the composite score
   (Scenario 5 below) does not treat this as a penalty — its `dataQuality` should read as
   limited, not simply omit budget adherence from a lower score.

## Scenario 4 — Trend over time (Story 2)

1. Ensure at least 3 consecutive months have transaction data (adjust transaction dates, or
   run through several months in a test environment).
2. Open Financial Health and use the range selector (same control as Analytics: "Last 3
   months" / "Last 6 months" / "This year" / "All time").
3. **Expected**: the trend chart plots one point per month; changing the range re-renders only
   the selected months. Each point's savings rate/adherence must match what Scenario 1's
   single-period card would show if that month were the latest one in range.

## Scenario 5 — Composite score direction (Story 3, SC-004)

1. With Scenario 1's data loaded, note the composite score.
2. Add one more expense transaction this month (worsening savings rate), reload the page.
3. **Expected**: the composite score decreases (or stays the same if already at its floor),
   never increases, and the breakdown still shows which of the two components moved.
4. Reverse: add an income transaction instead. **Expected**: score increases or stays the same,
   never decreases.

## Scenario 6 — Insufficient data for the composite score (Story 3, Acceptance Scenario 2)

1. Use a brand-new profile with a single month of data and no budgets.
2. Open Financial Health.
3. **Expected**: the score area indicates it's based on limited data (per FR-006) rather than
   presenting a bare, falsely-precise number with no caveat.

## Automated coverage (see tasks.md for the actual task breakdown)

- `tests/unit/financialHealthEngine.test.ts` — every pure function in
  [contracts/financial-health-engine.md](contracts/financial-health-engine.md), including the
  zero-income, zero-budget, and empty-trend boundary cases above.
- `tests/e2e/financialHealthInsights.spec.ts` — Scenarios 1, 4, and 5 end-to-end, using the
  same fixture-building patterns as `tests/e2e/analytics.spec.ts` and
  `tests/e2e/budgeting.spec.ts`.
