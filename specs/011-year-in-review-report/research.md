# Phase 0 Research: Year-in-Review / Monthly PDF Report

Most items below were resolvable from the existing codebase and constitution. The one
external decision is the PDF-generation library, since no PDF capability exists in this repo
today (no dependency, zero matches for "pdf" under `src/`).

## 1. Data source for income/expense totals (FR-002, FR-010)

**Decision**: Reuse `incomeExpenseTrend(key, dateFrom, dateTo)` from
[`analyticsEngine.ts`](../../src/domain/analytics/analyticsEngine.ts) as-is, then sum the
`income`/`expense` fields of every `MonthlyTrendPoint` it returns for the chosen period.

**Rationale**: FR-010 forbids a second calculation path for income/expense — the only durable
way to guarantee the report can never disagree with Analytics is to call the exact same
function. `incomeExpenseTrend` already excludes `type === 'transfer'` transactions (matching
spec Assumption "transfers... excluded"), and already sums per calendar month, so a single
month's report is just `trend[0]` and a full year's report is `trend.reduce(...)` over all
twelve (or fewer, if some months have no activity) points — no new transaction query.

**Alternatives considered**: Querying `TransactionRepository` directly and summing splits.
Rejected — duplicates logic that already exists, tested, and is the exact thing FR-010
prohibits.

## 2. Data source for top spending categories (FR-003, FR-010)

**Decision**: Reuse `categoryBreakdown(key, dateFrom, dateTo)` from `analyticsEngine.ts`
as-is; it already returns `{categoryId, categoryName, total}[]` sorted descending by spend
magnitude. The report takes the top `N = 5` entries (Assumptions: "a reasonably small number
shown by default (e.g., the top 5)"), matching how `AnalyticsPage.tsx` already presents the
same ranked list.

**Rationale**: Same FR-010 reasoning as §1 — one ranking function, reused, not reimplemented.

**Ties**: `categoryBreakdown`'s sort is a plain numeric `.sort((a,b) => b.total - a.total)`,
which is stable in every JS engine this app targets (evergreen browsers, ES2019+ stable
`Array.prototype.sort`), so categories tied on `total` keep a deterministic relative order
rather than being arbitrarily reordered on every render. To satisfy the Edge Case ("list tied
categories together rather than arbitrarily dropping one"), the top-N slice is taken by
**value**, not by fixed count: if the 5th and 6th entries share the same `total` as the cutoff,
both are included. See `topCategories()` in contracts/report-engine.md.

**Alternatives considered**: A new query directly against `TransactionRepository`/
`CategoryRepository`. Rejected for the same duplication reason as §1.

## 3. Net worth at start/end of period (FR-004, Edge Cases, FR-010)

**Decision**: Reuse `NetWorthSnapshotRepository.list(key)` from
[`wealthRepository.ts`](../../src/data/dexie/wealthRepository.ts) (already the single source
`netWorthTrend()` in `analyticsEngine.ts` and `NetWorthPage.tsx` read from) to fetch every
persisted snapshot, then select — never recompute — the value via a new pure helper,
`pickSnapshotAtOrBefore(snapshots, date)`, for both the period-start boundary and the
period-end boundary independently (Assumptions: "nearest available net worth snapshot at or
before each boundary date"). When no snapshot exists at or before a boundary, the helper
returns `null` and the report states that figure "could not be determined" (Edge Cases) rather
than showing zero.

**Rationale**: No such "nearest at-or-before" lookup exists anywhere in the codebase today —
`netWorthTrend()` only *filters* snapshots strictly inside `[dateFrom, dateTo]`, so it cannot
answer "what was net worth on this specific boundary date" when the boundary itself has no
snapshot. Adding this lookup is not a second *calculation* of net worth (FR-010's actual
concern): every number the helper can return is a `netWorth` value that was already computed
and persisted by the existing `recordNetWorthSnapshot()`/`computeNetWorth()` flow
(`wealthEngine.ts`) at some point in the past — the helper only *selects* which already-true
historical value answers a date query. This keeps the single source of truth for "what is net
worth" while filling a genuine, previously-nonexistent gap ("what was net worth *as of* date
X").

**Why not live-compute `computeNetWorth()` for a period end that is today**: Assumptions
explicitly settle both boundaries the same way ("nearest available snapshot... at or before
each boundary date") — special-casing "live compute when the end date is today" would be a
second, divergent way to answer "net worth at date X" depending on which date happened to be
asked, undermining the single-path guarantee FR-010 asks for. A user who wants an up-to-date
net worth figure already has the **Net Worth** page's live `computeNetWorth()`; this report's
job is a point-in-time historical rollup, not a live figure.

**Alternatives considered**: Live-computing net worth for "today" boundaries via
`computeNetWorth()`. Rejected per the paragraph above. Interpolating between snapshots.
Rejected — Assumptions explicitly specify "nearest available snapshot", not interpolation, and
inventing an interpolation rule would itself be new, untested calculation logic.

## 4. Resolving an arbitrary user-chosen month/year's boundaries (FR-001)

**Decision**: Reuse `getCurrentPeriodRange(periodType, referenceDate)` from
[`budgetEngine.ts`](../../src/domain/budgets/budgetEngine.ts) by constructing a
`referenceDate` that falls inside the user's chosen period (`new Date(year, month - 1, 1)` for
a chosen month, `new Date(year, 0, 1)` for a chosen year) and calling it with `periodType`
`'monthly'`/`'yearly'`. This already handles month-length/leap-year boundaries correctly (it
derives `lastDay` via `new Date(year, month + 1, 0).getDate()`) and already fixes the
local-day/UTC boundary bug documented in its own comment.

**Rationale**: `getCurrentPeriodRange` is misnamed for this use ("current") but its actual
contract — "the monthly/yearly period containing `referenceDate`" — is exactly what's needed
for an arbitrary past/future month or year too; the function itself has no dependency on
"today". Reusing it avoids a second, parallel implementation of calendar-boundary math (leap
years, 30-vs-31-day months) that could subtly disagree with how `Budget`/`AnalyticsPage`
periods are computed elsewhere.

**Alternatives considered**: A new date-boundary utility in the report module. Rejected — pure
duplication of already-correct, already-tested logic for no behavioral difference.

## 5. "In-progress period" indicator (FR-009, Edge Cases)

**Decision**: A period is in progress when `periodStart <= today <= periodEnd`, where
`today = new Date().toISOString().slice(0, 10)` — the same "local calendar day as an ISO
date string" expression already used elsewhere in this codebase for "today" (e.g.
`wealthEngine.ts`'s `recordNetWorthSnapshot` default date, `ExportPage.tsx`'s export filename
date). When true, the report displays a notice that its figures reflect data only up to the
moment of generation.

**Rationale**: Reusing the exact expression already established for "today" elsewhere keeps
this one internally consistent with the rest of the app rather than introducing a second,
possibly-subtly-different "what is today" computation. (This is a different concern from
`getCurrentPeriodRange`'s local-day boundary fix, which is about where a period's *edges* fall,
not about what "today" is.)

**Alternatives considered**: None — this is a direct, low-risk reuse of an established
pattern; no ambiguity to weigh alternatives against.

## 6. PDF generation library

**Decision**: Add **jsPDF** (`jspdf`, MIT license, current `4.2.1`) plus its companion table
plugin **jspdf-autotable** (`jspdf-autotable`, MIT license, current `5.0.8`) as new
dependencies. The report's summary figures render as simple text blocks (income/expense/net
income, net worth start/end/delta) and the ranked category list renders as a table via
`jspdf-autotable`, matching the on-screen figures exactly (FR-005) since both are built from
the same in-memory `ReportSummary` object.

**Rationale**: This is a purely client-side, offline-capable library with no network calls or
server component (Constitution Principle I), MIT-licensed and free with no recurring cost
(Principle V), and is the de facto standard choice for browser-side PDF generation in this
ecosystem — avoiding a hand-rolled PDF byte-stream implementation, which would be substantial,
error-prone, unrequested scope. The generated `Blob` is handed to the existing `file-saver`
`saveAs()` call already used by `ExportPage.tsx`'s CSV/XLSX export, so the download mechanism
itself is unchanged and consistent (same toast pattern, same disabled-while-exporting UX).

**Alternatives considered**: `pdfmake` (also MIT, declarative document-definition style) —
viable but adds a second, different API paradigm to learn/maintain versus jsPDF's more direct
draw calls plus one well-known table plugin; no functional advantage for this report's simple
layout (a few text blocks + one table). `react-pdf` (`@react-pdf/renderer`) — heavier
(React-reconciler-based PDF rendering), overkill for a single-page summary document.
Server-side PDF generation — rejected outright by Constitution Principle I (zero-server).

## 7. Placement: same screen as existing export (FR-007)

**Decision**: Extend the existing `ExportPage.tsx` in place with a new `Card` section (period
type toggle, year/month selector(s), "Generate Report" action, an inline report-summary
preview, and a "Download PDF" action) rather than adding a new route/page.

**Rationale**: FR-007 requires the report option to live "on the same screen as the existing
raw transaction export options, clearly distinguished" — the simplest way to satisfy this
literally is a second, visually distinct `Card` on the same `ExportPage.tsx`, not a new nav
item plus a cross-link. This also naturally satisfies User Story 1's "on-screen (or
pre-export) summary" (Independent Test) without a page navigation between "view" and "export".

**Alternatives considered**: A separate `/reports` (or similar) page linked from `ExportPage`.
Rejected — adds a navigation hop and a new route/nav item for no requirement that asks for a
dedicated page; a same-page section is the more literal, simpler reading of FR-007.

## 8. New persisted entity?

**Decision**: None. Confirmed against spec.md's own Key Entities section: "Report Period" is
explicitly "Not a stored entity"; "Report Summary" is explicitly "never independently
persisted". No new Dexie table, no schema version bump.

**Rationale**: Every figure is recomputed on demand from already-persisted ledger/net-worth
data; persisting a report snapshot would create a second, potentially-stale source of truth
FR-010 exists to prevent. The only artifact this feature produces is the downloaded PDF file
itself, which — like the existing CSV/XLSX exports — leaves the app's storage entirely once
downloaded.
