---
description: 'Task list template for feature implementation'
---

# Tasks: Year-in-Review / Monthly PDF Report

**Input**: Design documents from `/specs/011-year-in-review-report/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/report-engine.md](contracts/report-engine.md),
[quickstart.md](quickstart.md)

**Tests**: Included. Not one of Constitution Principle IV's four named engines, but held to
its bar per the precedent already set for specs 002-004/006/007 (plan.md's Constitution
Check) — the pure functions in `reportEngine.ts`, the read-only orchestrator in
`reportService.ts`, and the PDF builder in `reportPdfExport.ts` get unit/integration tests
before being considered done.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3). All three
stories share one `generateReportSummary()` orchestrator built in Foundational: US1 renders
its `ReportSummary` on screen, US2 turns that same object into a PDF, US3 is a placement/UI
concern on top of US1's markup. This keeps each story independently testable/shippable
without forward-referencing a story that hasn't landed yet.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths below are real paths in this repository, following the conventions in
  `src/domain/analytics/financialHealthEngine.ts` + `financialHealthService.ts` (pure-engine +
  thin-orchestrator split, spec 007) and `src/pages/ExportPage.tsx` (the existing CSV/XLSX
  export card pattern this feature's new section sits beside).

---

## Phase 1: Setup

**Purpose**: Add this feature's one new capability (PDF generation) and establish a clean
baseline before touching any other code

- [X] T001 Add `jspdf` (4.2.1) and `jspdf-autotable` (5.0.8) to `dependencies` in
      `package.json` (research.md §6) and run `npm install`, then run `npm run test` to
      confirm the existing suite passes cleanly before starting, establishing a baseline to
      diff against.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared types, pure period/ranking/selection math, and the read-only
orchestrator every story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 [P] Add `ReportPeriod`, `ReportSummary`, and `ReportCategoryItem` types to
      `src/domain/reports/reportEngine.ts` per [data-model.md](data-model.md):
      `ReportPeriod { type: 'monthly' | 'yearly'; year: number; month?: number }`;
      `ReportCategoryItem { categoryId: string; categoryName: string; total: number }`;
      `ReportSummary { period, periodStart, periodEnd, periodLabel, isInProgress, income,
      expense, netIncome, topCategories: ReportCategoryItem[], netWorthStart: number | null,
      netWorthEnd: number | null, netWorthDelta: number | null }`.
- [X] T003 [P] Write failing unit tests in `tests/unit/reportEngine.test.ts` for
      `resolveReportPeriodRange` (a chosen month → correct `periodStart`/`periodEnd`
      including a leap-year February and a December month; a chosen year → Jan 1–Dec 31),
      `formatReportPeriodLabel` (`"March 2026"` for monthly, `"2026"` for yearly),
      `isPeriodInProgress` (true when `today` falls within `[periodStart, periodEnd]`, false
      for a fully past or fully future period), `topCategories` (top-5 by default; a tie at
      the 5th/6th position keeps both — research.md §2; empty input → `[]`), and
      `pickSnapshotAtOrBefore` (returns the latest snapshot with `date <= date`; returns
      `null` when none exists — research.md §3) — per
      [contracts/report-engine.md](contracts/report-engine.md). Depends on T002 (needs the
      types to compile against).
- [X] T004 Implement `resolveReportPeriodRange`, `formatReportPeriodLabel`,
      `isPeriodInProgress`, `topCategories`, `pickSnapshotAtOrBefore`, and `buildReportSummary`
      in `src/domain/reports/reportEngine.ts` per
      [contracts/report-engine.md](contracts/report-engine.md) — pure, no I/O, no `CryptoKey`.
      `resolveReportPeriodRange` MUST delegate to the existing `getCurrentPeriodRange` from
      `src/domain/budgets/budgetEngine.ts` with a constructed reference date (research.md
      §4) rather than reimplementing calendar-boundary math. Must make T003's tests pass.
      Depends on T002, T003.
- [X] T005 Implement `generateReportSummary(key, period)` in
      `src/domain/reports/reportService.ts`: calls `resolveReportPeriodRange`, then the
      *existing* `incomeExpenseTrend` and `categoryBreakdown` from
      `src/domain/analytics/analyticsEngine.ts` (no new Dexie query — research.md §1-2) and
      the *existing* `NetWorthSnapshotRepository.list` from
      `src/data/dexie/wealthRepository.ts` (research.md §3); sums `income`/`expense` across
      every point `incomeExpenseTrend` returns; calls `buildReportSummary(...)` with the
      results plus `today = new Date().toISOString().slice(0, 10)` (research.md §5). Returns
      the resulting `ReportSummary`. Depends on T004.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Generate a report for a chosen period (Priority: P1) 🎯 MVP

**Goal**: A user picks a month or year on the Export screen and sees a correct on-screen
summary — total income, total expense, net income, top spending categories, and net worth
start/end/delta — for exactly that period, including zero-data and missing-net-worth-history
periods and an in-progress-period notice.

**Independent Test**: Select a month with known transactions and net worth history, generate
a report, and verify the on-screen summary shows the correct total income, total expense, top
categories, and net worth delta for exactly that period (per [quickstart.md](quickstart.md)
Scenarios 1-5).

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they fail before writing the implementation.

- [X] T006 [P] [US1] Write failing integration tests in
      `tests/integration/reportService.test.ts` for `generateReportSummary`: seeded income
      (₹50,000) and expense transactions (₹20,000 across ≥2 categories) plus net worth
      snapshots before and within a month produce income/expense/net income and a
      descending-ranked `topCategories` matching manual computation (quickstart Scenario 1); a
      full calendar year sums across all months with activity (Scenario 2); a period with no
      transactions and no snapshot at or before its start produces
      `income: 0, expense: 0, netIncome: 0, topCategories: [], netWorthStart: null,
      netWorthEnd: null, netWorthDelta: null` — never an error, never a fabricated zero for net
      worth (Scenario 3, FR-008, Edge Cases); the current in-progress month produces
      `isInProgress: true` (Scenario 4); two categories tied for the top spend both appear in
      `topCategories` (Scenario 5).

### Implementation for User Story 1

- [X] T007 [US1] Add a new "Generate a Report" `Card` section to `src/pages/ExportPage.tsx`,
      alongside (below) the existing CSV/XLSX export card: a period-type toggle (Month/Year),
      a year selector, a month selector (shown only when type is Month), a "Generate Report"
      button (disabled while generating, mirroring the existing `exporting` state pattern)
      that calls `generateReportSummary(key, period)`, and an inline preview `Card` rendering
      the returned `ReportSummary` — total income/expense/net income (reusing a local
      `formatMoney` helper matching `AnalyticsPage.tsx`'s pattern), the ranked
      `topCategories` list (or an explicit "No spending recorded for this period" line when
      empty), net worth start/end/delta (rendering `"Not available"` for any `null` field
      instead of `0` — Edge Cases), and a visible notice when `isInProgress` is true stating
      figures reflect data only up to the moment of generation (FR-009). Depends on T005. Must
      satisfy T006's scenarios when driven through the UI.

**Checkpoint**: User Story 1 is fully functional and independently testable — a period can be
selected, a report generated, and every figure on screen is correct, including the zero-data,
missing-net-worth, tied-category, and in-progress edge cases.

---

## Phase 4: User Story 2 - Export the report as a PDF (Priority: P2)

**Goal**: A user downloads the currently-generated report as a PDF whose figures and stated
period exactly match what was shown on screen.

**Independent Test**: Generate a report for a period and download it as a PDF file, then
verify the downloaded file opens and contains the same figures shown on screen (per
[quickstart.md](quickstart.md) Scenario 6).

### Tests for User Story 2 ⚠️

- [X] T008 [P] [US2] Write failing tests in `tests/integration/reportPdfExport.test.ts` for
      `buildReportPdfBlob`: a populated `ReportSummary` produces a non-empty `Blob` with PDF
      content (`type === 'application/pdf'`, non-zero size) without throwing; the all-zero/
      all-null `ReportSummary` from Scenario 3 also produces a valid, non-empty `Blob` without
      throwing (FR-008 extended to the export path). Also test `reportPdfFilename`: a monthly
      summary (`periodLabel: "March 2026"`) and a yearly summary (`periodLabel: "2026"`)
      produce distinct, filesystem-safe filenames (Acceptance Scenario 3, Story 2).

### Implementation for User Story 2

- [X] T009 [US2] Implement `buildReportPdfBlob(summary)` and `reportPdfFilename(summary)` in
      `src/data/io/reportPdfExport.ts` (sibling to the existing `exportService.ts`, same
      layer — no repository import, no `CryptoKey`) per
      [contracts/report-engine.md](contracts/report-engine.md), using `jsPDF` for the title/
      figures and `jspdf-autotable` for the `topCategories` table (research.md §6). Must make
      T008's tests pass. Depends on T008.
- [X] T010 [US2] Extend `src/pages/ExportPage.tsx`'s report preview `Card` (T007) with a
      "Download PDF" button that calls `buildReportPdfBlob(summary)` and passes the result to
      the existing `file-saver` `saveAs(blob, reportPdfFilename(summary))` — the same download
      mechanism and success/error `toast` pattern the existing CSV/XLSX buttons already use.
      Depends on T007, T009.

**Checkpoint**: User Stories 1 and 2 both work independently — the on-screen summary and the
downloaded PDF agree on every figure, and re-generating for a different period produces a
distinctly-named, distinctly-labeled file.

---

## Phase 5: User Story 3 - Discover the report alongside existing exports (Priority: P3)

**Goal**: A user on the Export screen finds the report-generation option presented clearly
alongside, not mixed into or hidden from, the existing raw-data export options.

**Independent Test**: Navigate to the existing Export screen and confirm the report
generation option is present and clearly distinct from the raw CSV/XLSX export options (per
[quickstart.md](quickstart.md) Scenario 7).

### Implementation for User Story 3

- [X] T011 [US3] Polish `src/pages/ExportPage.tsx`'s layout so the two concerns read as
      clearly separate: a distinct heading/description on the report `Card` (e.g. "Generate a
      Report" vs. the existing "Export Transactions" heading), visible spacing/separation
      between the two `Card`s, and page-level copy (e.g. an intro line) that names both
      capabilities so neither reads as a sub-option of the other (FR-007). No new
      logic — this is a markup/copy pass on top of T007's section, not built in T007 up front,
      so it can be validated against the finished US1+US2 layout rather than guessed at in
      isolation. Depends on T007 (and, for full navigability, is best validated after T010).

**Checkpoint**: All three user stories are independently functional — report generation,
PDF export, and clear on-screen discoverability alongside the existing export options.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T012 [P] Write E2E test `tests/e2e/yearInReviewReport.spec.ts` covering
      [quickstart.md](quickstart.md) Scenarios 1, 3, 4, and 6 end-to-end: navigate to Export,
      generate a monthly report with known seeded data and verify on-screen figures, generate
      a report for a no-data period and verify the zero/"not available" states, generate a
      report for the current in-progress month and verify the notice, and download the PDF
      and verify a file download occurs.
- [X] T013 Review all new code against Constitution Principle III (`reportEngine.ts` has zero
      repository/Dexie imports; `reportService.ts` calls only `analyticsEngine.ts`'s
      `incomeExpenseTrend`/`categoryBreakdown` and `wealthRepository.ts`'s
      `NetWorthSnapshotRepository.list`, never Dexie directly; `reportPdfExport.ts` has zero
      repository imports; `ExportPage.tsx` never imports Dexie) and confirm FR-010 in
      practice by grepping this feature's files for any independent transaction/category/
      net-worth query — there should be none outside the four reused functions/methods named
      above — before marking the feature complete. Also confirm no schema change was
      introduced (this feature persists nothing new — data-model.md, research.md §8), i.e.
      `src/data/dexie/db.ts`'s version count and `src/data/io/backupService.ts` are untouched
      by this feature's diff.
- [X] T014 [P] Run [quickstart.md](quickstart.md)'s Scenarios 1-7 manually against the dev
      build (`npm run dev`) to confirm the written scenarios match actual behavior, including
      the PDF's opened content (Scenario 6) which the automated tests only check for a
      non-empty Blob, not visual correctness.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational, and on US1's report preview `Card`
  (T007) which it extends with a Download button — not on US3's polish (T011).
- **User Story 3 (Phase 5)**: Depends on US1's `Card` section existing (T007); best validated
  once US2's Download button (T010) is also present, since it polishes the finished layout.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each Phase

- Tests MUST be written and confirmed failing before the implementation task(s) that follow
  them.
- Foundational: T002 must land before T003 (tests need the types); T004 implements against
  T003; T005 depends on T004.
- US1: T006 is written against T005's contract before T007 implements the page section.
- US2: T008 is written against the contract before T009 implements `reportPdfExport.ts`; T010
  depends on T007 (the preview `Card`) and T009.
- US3: T011 depends on T007, and is sequenced after US2 so the polish pass sees the finished
  two-`Card`, two-button layout rather than guessing at it mid-build.
- Polish: T012, T013, T014 can run in parallel once all stories are complete.

### Parallel Opportunities

- Foundational: T002 and T003 can be drafted in parallel once T002's types exist (T003 needs
  them to compile against, so T002 lands first; both still land well before T004).
- US1: T006 has no other US1 task to run alongside.
- US2: T008 has no other US2 task to run alongside (T009 depends on it).
- Polish: T012 and T014 touch different concerns (automated E2E vs. manual walkthrough) and
  can proceed in parallel; T013 (a code review pass) can run alongside both.

---

## Parallel Example: Foundational Phase

```bash
Task: "Add ReportPeriod/ReportSummary/ReportCategoryItem types to src/domain/reports/reportEngine.ts"
Task: "Write failing unit tests in tests/unit/reportEngine.test.ts"
```

## Parallel Example: Polish Phase

```bash
Task: "Write E2E test tests/e2e/yearInReviewReport.spec.ts"
Task: "Run quickstart.md Scenarios 1-7 manually against the dev build"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks everything else).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1-5 independently.
5. This alone delivers the spec's core, most load-bearing value — a correct, Analytics-
   consistent on-screen summary for any chosen period — before PDF export or placement polish
   is added.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → correct on-screen report for any period (MVP!).
3. User Story 2 → validate independently → the same figures, downloadable as a PDF.
4. User Story 3 → validate independently → the report option reads as clearly distinct from
   the existing raw exports.
5. Polish → E2E coverage, a Constitution/FR-010 compliance pass, and a full manual quickstart
   walkthrough.

## Notes

- [P] tasks touch different files with no unmet dependency.
- Every task in a user-story phase carries that story's label for traceability.
- Commit after each task or logical group; verify a test fails before implementing against
  it, and passes immediately after.
- This feature introduces no new Dexie table, no schema version bump, and no backup changes —
  T013 exists specifically to confirm that stayed true, since it's easy for an implementation
  to accidentally reach for a "cache" table that would violate research.md §8.
- `jspdf`/`jspdf-autotable` (T001) are this feature's only new dependencies; every other
  figure-producing function is reused, not reimplemented (research.md §1-3).
