# Phase 1 Data Model: Year-in-Review / Monthly PDF Report

No new Dexie table, no schema version bump, no new persisted entity (research.md §8). Every
shape below is a plain in-memory TypeScript type produced by a pure function or a thin
read-only orchestrator, then optionally rendered into a downloaded PDF `Blob` — never written
to storage.

## ReportPeriod (input)

The user's period selection. Matches spec's Key Entity of the same name — "Not a stored
entity; selected fresh each time a report is generated."

| Field   | Type                  | Notes                                                                                     |
| ------- | --------------------- | ------------------------------------------------------------------------------------------- |
| `type`  | `'monthly' \| 'yearly'` | Reuses `Budget['periodType']`'s existing union (`src/domain/entities.ts`) rather than a new one. |
| `year`  | `number`               | Calendar year, e.g. `2026`.                                                                 |
| `month` | `number \| undefined`  | 1–12. Required when `type === 'monthly'`; absent when `type === 'yearly'`.                  |

Resolved to concrete boundaries via `resolveReportPeriodRange(period)` →
`{ periodStart: string; periodEnd: string }` (`YYYY-MM-DD`), which is `budgetEngine.ts`'s
existing `getCurrentPeriodRange` called with a constructed reference date (research.md §4) —
not a new type, reuses `PeriodRange` from `budgetEngine.ts`.

## ReportSummary (output)

The computed, transient result for a `ReportPeriod`. Matches spec's "Report Summary" Key
Entity — "Derived entirely from existing transaction and net worth snapshot data; never
independently persisted."

| Field                  | Type                        | Notes                                                                                                  |
| ----------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `period`                | `ReportPeriod`               | Echoes the input selection, for labeling (FR-006).                                                          |
| `periodStart`           | `string` (`YYYY-MM-DD`)      | From `resolveReportPeriodRange`.                                                                             |
| `periodEnd`             | `string` (`YYYY-MM-DD`)      | From `resolveReportPeriodRange`.                                                                             |
| `periodLabel`           | `string`                     | Human-readable, e.g. `"March 2026"` or `"2026"` (FR-006).                                                    |
| `isInProgress`          | `boolean`                    | `true` when `periodStart <= today <= periodEnd` (research.md §5, FR-009).                                    |
| `income`                | `number`                     | Paise. Sum of `MonthlyTrendPoint.income` across the period (research.md §1).                                 |
| `expense`               | `number`                     | Paise, positive magnitude. Sum of `MonthlyTrendPoint.expense` across the period.                              |
| `netIncome`             | `number`                     | `income - expense` (FR-002).                                                                                 |
| `topCategories`         | `ReportCategoryItem[]`       | Ranked descending by `total`, ties included together (research.md §2, FR-003).                              |
| `netWorthStart`         | `number \| null`             | `pickSnapshotAtOrBefore(snapshots, periodStart)?.netWorth ?? null`. `null` = "could not be determined."      |
| `netWorthEnd`           | `number \| null`             | `pickSnapshotAtOrBefore(snapshots, periodEnd)?.netWorth ?? null`. Same null semantics.                        |
| `netWorthDelta`         | `number \| null`             | `netWorthEnd - netWorthStart` when both are non-null; `null` when either is `null` (FR-004, Edge Cases).      |

### ReportCategoryItem

| Field          | Type     | Notes                                              |
| -------------- | -------- | --------------------------------------------------- |
| `categoryId`   | `string` | From `CategoryBreakdownItem` (`analyticsEngine.ts`). |
| `categoryName` | `string` | Ditto.                                               |
| `total`        | `number` | Paise, spend magnitude. Ditto.                       |

**Validation rules** (enforced by the pure engine, not by storage — there is none):

- A period with zero transactions produces `income = 0`, `expense = 0`, `netIncome = 0`,
  `topCategories = []` — never an error (FR-008, Edge Cases).
- `netWorthDelta` is `null` whenever either `netWorthStart` or `netWorthEnd` is `null` — never
  computed from a mix of a real value and a fabricated zero (Edge Cases: "MUST state that a
  starting net worth could not be determined rather than showing a misleading number").
- `topCategories` includes every category tied with the Nth-ranked category's `total`, so its
  length MAY exceed the nominal top-N (5) when there is a tie at the cutoff (research.md §2).

## Relationships to existing entities (read-only)

```
Transaction ──┐
              ├──▶ incomeExpenseTrend() ──▶ ReportSummary.{income,expense,netIncome}
TransactionSplit ┘        (analyticsEngine.ts, unchanged)

TransactionSplit ──▶ categoryBreakdown() ──▶ ReportSummary.topCategories
Category      ──┘         (analyticsEngine.ts, unchanged)

NetWorthSnapshot ──▶ pickSnapshotAtOrBefore() ──▶ ReportSummary.{netWorthStart,netWorthEnd,netWorthDelta}
                           (NEW pure selector, reportEngine.ts — selects, never recomputes)

ReportSummary ──▶ buildReportPdfBlob() ──▶ downloaded PDF file (data/io/reportPdfExport.ts)
```

No arrow points *into* `Transaction`/`TransactionSplit`/`Category`/`NetWorthSnapshot` — this
feature only reads already-computed aggregates and already-persisted snapshots, never writes
(Constitution Principle III: UI → Domain → Data, one-way; Principle VI: nothing new to
soft-delete since nothing new is stored).
