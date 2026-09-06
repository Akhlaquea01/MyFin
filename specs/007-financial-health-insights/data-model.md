# Phase 1 Data Model: Financial Health Insights

No new Dexie table, no schema version bump, no new persisted entity (research.md §7). Every
shape below is a plain in-memory TypeScript type returned by a pure function or a thin
read-only orchestrator — never written to storage.

## FinancialHealthMetrics

The single-period figures behind Story 1. One instance represents one month.

| Field                | Type             | Notes                                                                                       |
| --------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `month`               | `string`         | `"YYYY-MM"` — matches `MonthlyTrendPoint.month` from `analyticsEngine.ts`.                     |
| `income`              | `number`         | Paise; carried through from `incomeExpenseTrend`, transfers already excluded.                  |
| `expense`             | `number`         | Paise, positive magnitude; carried through from `incomeExpenseTrend`.                          |
| `savingsRate`         | `number \| null` | `(income − expense) / income`. `null` when `income <= 0` (FR-003).                              |
| `expenseToIncomeRatio`| `number \| null` | `expense / income`. `null` when `income <= 0` (FR-003).                                        |
| `budgetAdherence`     | `number \| null` | Percent (0–100) of that month's budgets with `actualAmount <= plannedAmount`. `null` when no budget items bucket into that month (FR-002, Edge Cases). |
| `budgetsConsidered`   | `number`         | Count of budget-period rows bucketed into this month (0 when `budgetAdherence` is `null`); lets the UI distinguish "no budgets" from "0% adherence". |

**Validation rules** (enforced by the pure engine, not by storage — there is none):
- `savingsRate` and `expenseToIncomeRatio` are `null` together whenever `income <= 0` (FR-003) —
  never independently null/non-null, since both share the same denominator.
- `budgetAdherence` is `null` when `budgetsConsidered === 0`, and only then.

## FinancialHealthTrendPoint

Story 2's per-period trend array is simply `FinancialHealthMetrics[]`, one entry per month in
the selected `DateRange`, sorted ascending by `month` — no separate type; reusing
`FinancialHealthMetrics` keeps "the trend's last point" and "the current single period" (per
research.md §4) provably the same shape and the same value.

## FinancialHealthScore

The composite figure behind Story 3, computed from the **last** point of a
`FinancialHealthMetrics[]` trend plus the trend's own length/coverage.

| Field                    | Type                          | Notes                                                                                   |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| `score`                   | `number \| null`              | 0–100. `null` when neither component is available (Story 3, Acceptance Scenario 2).         |
| `dataQuality`             | `'full' \| 'limited'`         | `'full'` only when both components are non-null AND ≥ `MIN_HEALTH_SCORE_PERIODS` (3) months in the trend have `income > 0` (research.md §5). |
| `breakdown.savingsRate`   | `{ value: number \| null; component: number \| null; weight: number }` | `value` is the raw ratio (for display, e.g. "32%"); `component` is the clamped 0–100 contribution; `weight` is `0.6`. |
| `breakdown.budgetAdherence` | `{ value: number \| null; component: number \| null; weight: number }` | `value`/`component` are the same percent (adherence is already 0–100); `weight` is `0.4`. |

**Validation rules**:
- `score` is `null` iff both `breakdown.savingsRate.component` and
  `breakdown.budgetAdherence.component` are `null`.
- `dataQuality` is never `'full'` when `score` is `null` (an absent score is definitionally
  not full-confidence).

## Relationships to existing entities (read-only)

```
Transaction ──┐
              ├──▶ incomeExpenseTrend() ──▶ FinancialHealthMetrics.{income,expense,savingsRate,expenseToIncomeRatio}
TransactionSplit ┘        (analyticsEngine.ts, unchanged)

Budget ──┐
BudgetItem ──┴──▶ budgetPerformance() ──▶ FinancialHealthMetrics.{budgetAdherence,budgetsConsidered}
              (analyticsEngine.ts, unchanged)

FinancialHealthMetrics[] (trend) ──▶ FinancialHealthScore (last point + coverage check)
```

No arrows point *into* `Transaction`/`Budget`/`BudgetItem` — this feature never writes to the
ledger or to budgets, only reads already-computed aggregates (Constitution Principle III: UI →
Domain → Data, one-way).
