# Contract: Year-in-Review Report Engine

Mirrors the split this codebase already uses for spec 007
(`financialHealthEngine.ts` pure + `financialHealthService.ts` orchestrator): the actual
period/selection/ranking math is pure, unit-testable functions with no I/O; a separate thin
service does the Dexie/repository reads and hands their output to the pure functions. Nothing
here writes anything. A third, presentation-only module turns the finished `ReportSummary`
into a downloadable PDF `Blob`, following the same shape `exportService.ts` already uses for
CSV/XLSX.

## Pure functions — `src/domain/reports/reportEngine.ts`

No `CryptoKey`, no repository import, no `async`. Input/output only.

### `resolveReportPeriodRange(period: ReportPeriod): PeriodRange`

- Delegates to `getCurrentPeriodRange` from `../budgets/budgetEngine` (imported, not
  reimplemented — research.md §4), called with a constructed `referenceDate` inside the
  requested period:
  - `type === 'monthly'` → `new Date(period.year, period.month! - 1, 1)`, `periodType`
    `'monthly'`.
  - `type === 'yearly'` → `new Date(period.year, 0, 1)`, `periodType` `'yearly'`.
- Returns `budgetEngine.ts`'s existing `PeriodRange` shape (`{ periodStart, periodEnd }`)
  unchanged.

### `formatReportPeriodLabel(period: ReportPeriod): string`

- `type === 'monthly'` → e.g. `"March 2026"` (locale month name + year).
- `type === 'yearly'` → e.g. `"2026"`.
- Pure string formatting; no I/O, no dependency on "today" (FR-006).

### `isPeriodInProgress(range: PeriodRange, today: string): boolean`

- Returns `range.periodStart <= today && today <= range.periodEnd` (research.md §5, FR-009).
- `today` is passed in (not read internally via `new Date()`) so the function stays pure and
  deterministically testable.

### `topCategories(breakdown: CategoryBreakdownItem[], limit: number = 5): ReportCategoryItem[]`

- Assumes `breakdown` is already sorted descending by `total` (the contract
  `categoryBreakdown()` in `analyticsEngine.ts` already provides — this function does not
  re-sort).
- Returns the first `limit` items, **extended** to include every subsequent item whose `total`
  equals the `limit`-th item's `total` (research.md §2 — ties at the cutoff are kept together,
  never arbitrarily dropped).
- Returns `[]` when `breakdown` is empty (FR-008).

### `pickSnapshotAtOrBefore(snapshots: NetWorthSnapshot[], date: string): NetWorthSnapshot | null`

- `snapshots` need not be pre-sorted; the function sorts a copy descending by `date` internally
  and returns the first entry with `date <= date`, or `null` if none exists (research.md §3,
  Edge Cases: "state that a starting net worth could not be determined").
- When multiple snapshots share the same `date`, returns the last one in `snapshots`' original
  array order (matches `NetWorthSnapshotRepository.create`'s natural insertion order — no
  additional tie-break rule invented).

### `buildReportSummary(input: { period: ReportPeriod; range: PeriodRange; today: string; income: number; expense: number; categoryBreakdown: CategoryBreakdownItem[]; snapshots: NetWorthSnapshot[] }): ReportSummary`

- Pure composition of the four functions above (plus `netIncome = income - expense`) into one
  `ReportSummary`-shaped object (data-model.md). The caller (the service below) is responsible
  for supplying already-summed `income`/`expense` for the whole period — this function does not
  sum trend points itself, keeping the "sum across months" step visible/testable at the service
  boundary (research.md §1).

## Orchestrator (impure, read-only) — `src/domain/reports/reportService.ts`

### `generateReportSummary(key: CryptoKey, period: ReportPeriod): Promise<ReportSummary>`

1. `range = resolveReportPeriodRange(period)`.
2. Calls `incomeExpenseTrend(key, range.periodStart, range.periodEnd)` and
   `categoryBreakdown(key, range.periodStart, range.periodEnd)` from the existing
   `analyticsEngine.ts` — no new query against `TransactionRepository`/`CategoryRepository`
   (research.md §1–2).
3. Sums the `income`/`expense` fields across every point `incomeExpenseTrend` returned (a
   period entirely without transactions returns an empty trend array, summing to `0`/`0` —
   FR-008).
4. Calls `NetWorthSnapshotRepository.list(key)` from `wealthRepository.ts` — the same
   repository `netWorthTrend()` already reads (research.md §3).
5. Calls `buildReportSummary(...)` with the results of 1–4 plus
   `today = new Date().toISOString().slice(0, 10)`.
6. Returns the resulting `ReportSummary`. No independent calculation path — every figure is
   provably derived from the same functions Analytics/Net Worth already use (FR-010).

## Presentation (impure, no repository access) — `src/data/io/reportPdfExport.ts`

Sibling to the existing `src/data/io/exportService.ts` (same layer: consumes already-computed
data, produces a downloadable `Blob`, touches no repository, no `CryptoKey`).

### `buildReportPdfBlob(summary: ReportSummary): Blob`

- Builds a single-page PDF via `jsPDF` (research.md §6): a title block with `periodLabel` and,
  when `isInProgress`, a notice that figures reflect data only up to generation time (FR-009);
  an income/expense/net-income block (FR-002); a `jspdf-autotable` table of `topCategories`
  (FR-003), or an explicit "No spending recorded" line when empty (FR-008); a net worth
  start/end/delta block, rendering `"Not available"` for any `null` field instead of `0`
  (FR-004, Edge Cases).
- Synchronous, pure with respect to its input (same `ReportSummary` in → byte-identical PDF
  out) — no `Date.now()`/`Math.random()` inside beyond what `jsPDF` itself stamps into PDF
  metadata (irrelevant to visible content), so the exported PDF's *visible* figures are
  guaranteed to match the on-screen summary it was built from (FR-005, SC-002).

### `reportPdfFilename(summary: ReportSummary): string`

- e.g. `` `myfin-report-${summary.periodLabel.replace(/\s+/g, '-').toLowerCase()}.pdf` `` →
  `myfin-report-march-2026.pdf` / `myfin-report-2026.pdf` — distinguishable per period per
  Acceptance Scenario 3 of User Story 2, following the same `myfin-<thing>-<suffix>` filename
  convention `ExportPage.tsx` already uses for `myfin-transactions-${date}.csv`.

## What callers get for free by using this contract

- Story 1 (generate + view): `ExportPage.tsx` calls `generateReportSummary(key, period)` and
  renders the returned `ReportSummary` directly in a preview `Card` — one call, one object,
  nothing computed in the component itself.
- Story 2 (export as PDF): `ExportPage.tsx` calls `buildReportPdfBlob(summary)` on the
  already-generated summary (no re-fetch) and hands the `Blob` to the existing `file-saver`
  `saveAs()` call, exactly like the CSV/XLSX buttons.
- Story 3 (discoverability): purely a placement/UI concern (research.md §7); this contract is
  agnostic to where the calling component lives.
