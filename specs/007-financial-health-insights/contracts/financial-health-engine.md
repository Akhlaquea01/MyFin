# Contract: Financial Health Engine

Mirrors the split this codebase already uses for spec 006
(`categorizationEngine.ts` pure + a thin orchestrator): the actual math is pure, unit-testable
functions with no I/O; a separate thin service does the Dexie reads and hands their output to
the pure functions. Nothing here writes anything.

## Pure functions — `src/domain/analytics/financialHealthEngine.ts`

No `CryptoKey`, no repository import, no `async`. Input/output only.

### `computeSavingsRate(income: number, expense: number): number | null`

- Returns `(income - expense) / income`.
- Returns `null` when `income <= 0` (FR-003) — never `Infinity`/`NaN`/a negative-from-negative-
  income artifact.

### `computeExpenseToIncomeRatio(income: number, expense: number): number | null`

- Returns `expense / income`.
- Returns `null` when `income <= 0` (FR-003), same guard as above (both derive from the same
  denominator — see data-model.md's paired-nullness rule).

### `computeBudgetAdherence(items: { plannedAmount: number; actualAmount: number }[]): { adherence: number | null; considered: number }`

- `considered = items.length`.
- `adherence = null` when `considered === 0` (Edge Cases: no active budgets → not applicable,
  never a silently-penalizing 0).
- Otherwise `adherence = 100 * (count of items where actualAmount <= plannedAmount) / considered`.
  The `<=` comparison MUST match `AnalyticsPage.tsx`'s existing "Over budget" check
  (`actualAmount > plannedAmount`) exactly, so a budget flagged over there is never counted as
  "adhered to" here (FR-007, research.md §2).

### `buildMonthlyMetrics(income: number, expense: number, budgetItems: {plannedAmount:number; actualAmount:number}[]): FinancialHealthMetrics` (excluding `month`, which the caller fills in)

- Pure composition of the three functions above into one `FinancialHealthMetrics`-shaped
  object (data-model.md).

### `computeFinancialHealthScore(trend: FinancialHealthMetrics[]): FinancialHealthScore`

- Reads only the **last** element of `trend` for the score/breakdown components
  (research.md §4); reads the **whole array's length and each point's `income > 0`** only to
  decide `dataQuality`.
- `dataQuality = 'full'` iff both components in the last point are non-null AND at least
  `MIN_HEALTH_SCORE_PERIODS` (`3`) points in `trend` have `income > 0`. Otherwise `'limited'`.
- `score = null` iff both components of the last point are `null`.
- Weighting: `0.6` savings-rate component + `0.4` budget-adherence component when both
  present; the sole available component alone (unweighted) when only one is present
  (research.md §5).
- Empty `trend` → `{ score: null, dataQuality: 'limited', breakdown: { savingsRate: {value:null,component:null,weight:0.6}, budgetAdherence: {value:null,component:null,weight:0.4} } }`.

**Determinism**: every function above is a pure, synchronous, referentially-transparent
mapping from its arguments to its return value — same inputs always produce the same output,
with no reliance on wall-clock time, randomness, or module-level state. This is what makes
them unit-testable without touching Dexie (Constitution Principle IV precedent, same bar spec
006 held its pure engine to).

## Orchestrator (impure, read-only) — `src/domain/analytics/financialHealthService.ts`

### `getFinancialHealthTrend(key: CryptoKey, dateFrom: string, dateTo: string): Promise<FinancialHealthMetrics[]>`

1. Calls `incomeExpenseTrend(key, dateFrom, dateTo)` and `budgetPerformance(key, dateFrom, dateTo)`
   from the existing `analyticsEngine.ts` — no new query against `TransactionRepository`/
   `BudgetRepository` (research.md §1–2).
2. Groups the `budgetPerformance` rows by `periodStart.slice(0, 7)` (research.md §3).
3. For every month present in the `incomeExpenseTrend` result (a month with zero income/expense
   activity still needs a metrics row so the trend chart has a continuous x-axis), calls
   `buildMonthlyMetrics(...)` with that month's income/expense and its bucketed budget rows
   (empty array if none).
4. Returns the resulting `FinancialHealthMetrics[]`, already sorted ascending by month
   (`incomeExpenseTrend`'s own sort order, unchanged).

### `getFinancialHealthScore(key: CryptoKey, dateFrom: string, dateTo: string): Promise<FinancialHealthScore>`

- Calls `getFinancialHealthTrend` then `computeFinancialHealthScore` on the result. No
  independent query path — the score is provably derived from the same trend the UI renders,
  never a second calculation that could silently disagree with it.

## What callers get for free by using this contract

- Story 1 (single-period cards): render `trend[trend.length - 1]` (or an explicit "not enough
  data" empty state when `trend.length === 0`).
- Story 2 (trend chart): render `trend` directly against the existing `DateRangeSelector` +
  Chart.js pattern already used by `AnalyticsPage.tsx`.
- Story 3 (composite score): render `getFinancialHealthScore`'s result; `dataQuality ===
  'limited'` drives the "based on limited data" notice (FR-006).
