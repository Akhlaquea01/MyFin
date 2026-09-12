# Quickstart: Year-in-Review / Monthly PDF Report

## Prerequisites

- Dev server running: `npm run dev`
- An onboarded profile (PIN set) with at least one account
- Node/Vitest available for the unit-test scenarios below (`npm run test`)

## Scenario 1 — Monthly report matches manual computation (Story 1, SC-001, SC-002)

1. Record an income transaction: +₹50,000 this month, category "Salary".
2. Record expense transactions this month totaling ₹20,000 across at least two categories
   (e.g. ₹12,000 "Groceries", ₹8,000 "Dining").
3. Record two net worth snapshots via **Net Worth** (or your onboarding flow): one dated
   before this month started, one dated within this month.
4. Navigate to **Export** (sidebar), select the new Report section, choose period type
   "Month" and this month, click **Generate Report**.
5. **Expected** (within 10 seconds of clicking Generate — SC-001):
   - Total income = ₹50,000, total expense = ₹20,000, net income = ₹30,000.
   - Top categories list shows "Groceries" (₹12,000) above "Dining" (₹8,000).
   - Net worth start/end/delta shown, matching the two recorded snapshots.
   - Cross-check every figure against the existing **Analytics** page for the same month
     range — they must match exactly (SC-002, FR-010).

## Scenario 2 — Full-year report (Acceptance Scenario 4, Story 1)

1. With data spread across at least two months of the current year, select period type
   "Year" and the current year, then **Generate Report**.
2. **Expected**: income/expense/net income are the sums across the whole year (not just one
   month), and the top categories list reflects year-wide totals.

## Scenario 3 — Period with no data (Acceptance Scenario 5, Story 1, FR-008)

1. Select a past month with zero transactions and no net worth snapshot at or before it (e.g.
   before the profile's earliest recorded activity).
2. **Expected**: report still generates (no error) — income/expense/net income all show ₹0,
   the categories section clearly states there was no spending, and net worth start/end each
   read "Not available" (never a misleading ₹0) with delta also "Not available".

## Scenario 4 — In-progress period notice (Edge Cases, FR-009)

1. Select period type "Month" and the current (still in-progress) month.
2. **Expected**: the report generates and visibly states that its figures reflect data only up
   to the moment of generation.

## Scenario 5 — Tied top categories (Edge Cases)

1. Create two categories with exactly equal total spend this month, both higher than every
   other category.
2. Generate the report for this month.
3. **Expected**: both tied categories appear in the top list together — neither is silently
   dropped to keep the list at exactly 5 rows.

## Scenario 6 — Export as PDF (Story 2, SC-003, FR-005, FR-006)

1. From Scenario 1's generated report, click **Download PDF**.
2. **Expected**: a PDF file downloads (2 actions total from viewing the report: Generate →
   Download — satisfies SC-003's "under 3 actions"). Opening it shows:
   - The period clearly labeled (e.g. "March 2026").
   - The same income/expense/net income, top categories, and net worth delta shown on screen.
3. Generate and export a second report for a different period (e.g. a different month).
4. **Expected**: the two downloaded files have distinct filenames (e.g.
   `myfin-report-march-2026.pdf` vs. `myfin-report-april-2026.pdf`) and each PDF's own labeled
   period matches its filename (Acceptance Scenario 3, Story 2).

## Scenario 7 — Discoverable alongside existing export (Story 3)

1. Navigate to **Export** without prior context.
2. **Expected**: the report-generation section is visible on the same screen as the existing
   "Export as CSV" / "Export as XLSX" buttons, clearly distinguished as a separate card/section
   (FR-007) — no separate navigation needed to find it.

## Automated coverage (see tasks.md for the actual task breakdown)

- `tests/unit/reportEngine.test.ts` — every pure function in
  [contracts/report-engine.md](contracts/report-engine.md): period resolution for arbitrary
  month/year (including leap-year Feb and December→January year boundaries), label formatting,
  in-progress detection, top-N-with-ties slicing, nearest-snapshot-at-or-before selection
  (including the "no snapshot exists" null case), and `buildReportSummary`'s zero-data and
  null-net-worth boundary cases.
- `tests/integration/reportPdfExport.test.ts` (or similar) — `buildReportPdfBlob` produces a
  non-empty, valid PDF `Blob` for a populated summary and for the all-zero/all-null summary
  from Scenario 3, without throwing.
- `tests/e2e/yearInReviewReport.spec.ts` — Scenarios 1, 3, 4, and 6 end-to-end, using the same
  fixture-building patterns as `tests/e2e/importExportBackup.spec.ts` and
  `tests/e2e/analytics.spec.ts`.
