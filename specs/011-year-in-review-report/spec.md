# Feature Specification: Year-in-Review / Monthly PDF Report

**Feature Branch**: `011-year-in-review-report`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Year-in-review / monthly PDF report: generate an auto-generated financial summary document for a chosen period (a specific month or a full year) that the user can export as a PDF, complementing the existing raw transaction CSV/XLSX export on ExportPage.tsx. The report summarizes total income vs. total spend for the period, a breakdown of top spending categories, and the net worth delta (start vs. end of period), reusing the same underlying data already powering AnalyticsPage and the net worth snapshot history — no new analytics engine, just a new presentable, downloadable rollup of numbers the app already computes."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Generate a report for a chosen period (Priority: P1)

A user wants a single readable document summarizing their finances for a specific month or a full year — how much came in, how much went out, where most of it went, and how their net worth moved — instead of piecing it together from several charts and a raw transaction spreadsheet.

**Why this priority**: This is the entire value of the feature. Without a period picker and a generated summary, there is nothing to export.

**Independent Test**: Can be fully tested by selecting a month with known transactions and net worth history, generating the report, and verifying the on-screen (or pre-export) summary shows the correct total income, total expense, top categories, and net worth delta for exactly that period.

**Acceptance Scenarios**:

1. **Given** transactions and net worth history exist for a given month, **When** the user selects that month and requests a report, **Then** the report shows total income, total expense, and the net income (income minus expense) for that month.
2. **Given** the same period, **When** the report is generated, **Then** it shows the categories with the highest total spend for that period, ranked highest first, each with its total amount.
3. **Given** net worth snapshots exist before and after the period, **When** the report is generated, **Then** it shows the net worth at the start of the period, the net worth at the end of the period, and the difference between them.
4. **Given** the user instead selects a full calendar year, **When** the report is generated, **Then** all of the above figures are computed across the entire year rather than a single month.
5. **Given** a period with no transactions at all, **When** the user requests a report for it, **Then** the report is still generated and clearly shows zero income, zero expense, and no spending categories, rather than failing.

---

### User Story 2 - Export the report as a PDF (Priority: P2)

Having reviewed the generated summary, the user wants to save or share it as a PDF file — to keep for their own records, print it, or send it to someone else (e.g., an accountant or a partner) — the same way they can already export a raw transaction spreadsheet from the Export page.

**Why this priority**: Viewing the summary in-app already delivers most of the value (User Story 1); exporting it is what makes it portable and shareable, but it is a distinct, separable step.

**Independent Test**: Can be fully tested by generating a report for a period and downloading it as a PDF file, then verifying the downloaded file opens and contains the same figures shown on screen.

**Acceptance Scenarios**:

1. **Given** a generated report for a period, **When** the user chooses to export it, **Then** a PDF file is produced and downloaded containing the same income/expense totals, top categories, and net worth delta shown on screen.
2. **Given** an exported report, **When** the user opens the PDF, **Then** the period it covers (e.g., "March 2026" or "2026") is clearly labeled in the document.
3. **Given** the user generates and exports reports for two different periods, **When** they compare the resulting files, **Then** each file is distinguishable by its filename and by the period stated inside it.

---

### User Story 3 - Discover the report alongside existing exports (Priority: P3)

A user who already knows how to export their raw transactions expects to find this new report in the same place, rather than hunting for a separate, disconnected feature.

**Why this priority**: A pure discoverability/placement concern — the report is fully functional without this, but adoption suffers if it's hidden.

**Independent Test**: Can be fully tested by navigating to the existing Export screen and confirming the report generation option is present and clearly distinct from the raw data export options.

**Acceptance Scenarios**:

1. **Given** the user is on the existing transaction export screen, **When** they look for a way to generate a period summary, **Then** they find it presented alongside (not replacing) the existing CSV/XLSX export options.

---

### Edge Cases

- What happens when the user requests a report for a period that includes today (an in-progress month or the current year)? The report MUST clearly indicate it covers only the data recorded up to the moment of generation, not a full completed period.
- What happens when no net worth snapshot exists at or before the start of the requested period? The report MUST state that a starting net worth could not be determined rather than showing a misleading number (e.g., zero).
- What happens when a period has income and expense transactions but ties for the top spending category? The report MUST list tied categories together rather than arbitrarily dropping one.
- What happens when the requested period predates the user's earliest recorded transaction? The report MUST still generate, showing zeros/"no data" for that period rather than erroring.
- What happens when generating or exporting a very large period (e.g., several years of transactions) takes a noticeable amount of time? The user MUST see a clear in-progress indicator rather than an unresponsive screen.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST let the user choose a report period that is either a single calendar month or a single calendar year.
- **FR-002**: For the chosen period, the system MUST compute and display total income, total expense, and net income (income minus expense), using the same transaction data already relied on elsewhere in the app.
- **FR-003**: For the chosen period, the system MUST compute and display the highest-spending categories ranked by total amount spent, each shown with its category name and total.
- **FR-004**: For the chosen period, the system MUST compute and display the net worth at the start of the period, the net worth at the end of the period, and the difference between them.
- **FR-005**: The system MUST allow the user to export the generated report as a downloadable PDF file whose content matches what was shown on screen.
- **FR-006**: The exported PDF MUST clearly state which period (month or year) it covers.
- **FR-007**: The system MUST present the report generation option on the same screen as the existing raw transaction export options, clearly distinguished from them.
- **FR-008**: The system MUST generate a valid report (showing zero/empty results rather than an error) for a period containing no transactions or no applicable net worth history.
- **FR-009**: When the chosen period is still in progress (includes the current date), the report MUST indicate that its figures reflect data only up to the time of generation.
- **FR-010**: The system MUST NOT introduce a separate/duplicate calculation path for income, expense, category totals, or net worth — it MUST reuse the app's existing derived figures for these values so the report can never disagree with what the rest of the app shows for the same period.

### Key Entities

- **Report Period**: A user-selected span — either one calendar month or one calendar year — that bounds every figure shown in a generated report. Not a stored entity; selected fresh each time a report is generated.
- **Report Summary**: The computed, transient result for a given period: total income, total expense, net income, ranked top spending categories with amounts, and start/end/delta net worth. Derived entirely from existing transaction and net worth snapshot data; never independently persisted.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can generate a report for any month or year with existing data in under 10 seconds from selecting the period.
- **SC-002**: Every figure shown in a generated report (income, expense, top categories, net worth delta) exactly matches the equivalent figure computed elsewhere in the app for the same period, with zero discrepancy.
- **SC-003**: A user can go from viewing a generated report to holding a downloaded PDF of it in under 3 actions.
- **SC-004**: 100% of periods — including those with no data, ties in top categories, or missing net worth history — produce a valid, non-erroring report.

## Assumptions

- "Top spending categories" means expense transactions grouped by category, ranked by total amount, limited to a reasonably small number shown by default (e.g., the top 5), consistent with how category breakdowns are already presented on the Analytics page.
- Net worth "start of period" and "end of period" use the nearest available net worth snapshot at or before each boundary date, since snapshots are not guaranteed to exist for every single day.
- This feature produces a read-only, point-in-time document; it does not introduce scheduled/automatic report generation or emailing — the user explicitly requests each report.
- The report format is a single, single-currency financial summary consistent with the rest of the app's single-currency assumption; no multi-currency conversion is involved.
- Transfers between the user's own accounts are excluded from income/expense totals, consistent with how the rest of the app already treats transfers.
