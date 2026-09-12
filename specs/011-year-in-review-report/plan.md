# Implementation Plan: Year-in-Review / Monthly PDF Report

**Branch**: `011-year-in-review-report` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/011-year-in-review-report/spec.md`

## Summary

A user picks a single calendar month or year on the existing Export screen and generates a
read-only summary — total income, total expense, net income, top spending categories, and
net-worth start/end/delta for that period — then optionally downloads it as a PDF. Technical
approach: a new pure `reportEngine.ts` (period-boundary resolution via the existing
`budgetEngine.getCurrentPeriodRange`, top-category ranking with tie handling, nearest-snapshot
selection, in-progress detection — no I/O) plus a thin `reportService.ts` orchestrator that
calls the *existing* `incomeExpenseTrend()`/`categoryBreakdown()` from `analyticsEngine.ts` and
the *existing* `NetWorthSnapshotRepository.list()` rather than querying transactions or
snapshots again — the only way to durably guarantee this report never disagrees with
Analytics/Net Worth (FR-010). A new `reportPdfExport.ts` (sibling to `exportService.ts`) turns
the resulting `ReportSummary` into a PDF `Blob` via jsPDF + jspdf-autotable (this repo's first
PDF capability), reusing the existing `file-saver` download pattern. `ExportPage.tsx` gains one
new `Card` section — period picker, Generate, inline preview, Download PDF — alongside its
existing CSV/XLSX export buttons (FR-007), with no new route.

## Technical Context

**Language/Version**: TypeScript 5.x, same evergreen-browser target as the core app (Vite)

**Primary Dependencies**: React 19 + React Router, shadcn/ui on Tailwind CSS, Dexie.js, and
Vitest are all reused unchanged — see
[../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md). **New**:
`jspdf` (4.2.1, MIT) + `jspdf-autotable` (5.0.8, MIT) for client-side PDF generation
(research.md §6) — this app's first PDF-capable dependency.

**Storage**: IndexedDB via Dexie.js — no new table, no schema version bump. This feature reads
existing `transactions`/`transactionSplits`/`categories` (via `analyticsEngine.ts`'s
`incomeExpenseTrend`/`categoryBreakdown`) and `netWorthSnapshots` (via
`NetWorthSnapshotRepository.list`) only; it never queries Dexie directly and never writes
anything (data-model.md, research.md §1–3, §8).

**Testing**: Vitest unit tests for every pure function in `reportEngine.ts` (period resolution
across month/year/leap-year/year-boundary cases, label formatting, in-progress detection,
top-N-with-ties ranking, nearest-snapshot-at-or-before selection including "no snapshot exists"
— contracts/report-engine.md) plus a Vitest/integration test that `buildReportPdfBlob` produces
a valid, non-empty `Blob` for both a populated and an all-zero/all-null summary without
throwing, and a Playwright E2E test covering generate → on-screen preview → PDF download for a
populated period and a no-data period (quickstart.md Scenarios 1, 3, 4, 6).

**Target Platform**: Same installable PWA (Android/iOS/desktop); PDF generation and download
happen entirely client-side (jsPDF renders bytes in-browser, `file-saver` triggers the
download) — no platform-specific behavior, no new route.

**Project Type**: Web — single frontend-only project (no backend exists or is planned)

**Performance Goals**: One `incomeExpenseTrend` + `categoryBreakdown` call pair (already the
same cost class Analytics pays per range selection) plus one `NetWorthSnapshotRepository.list`
call per report generation — not per-category/per-month; PDF byte generation is synchronous
in-browser work on an already-computed, small summary object. Target: full generate-to-preview
in well under SC-001's 10-second budget for realistic transaction volumes.

**Constraints**: The report MUST NOT introduce any independent calculation of income, expense,
category totals, or net worth (FR-010) — every figure traces to an existing, already-tested
function or an already-persisted snapshot value, never a new aggregation. A period with no
transactions or no applicable net-worth history MUST still render a valid, non-erroring report
(FR-008). An in-progress period MUST visibly say its figures are partial (FR-009). A missing
net-worth boundary MUST render as "not available", never as a misleading zero (Edge Cases).

**Scale/Scope**: Single user per installation; one new domain module pair (pure engine + thin
orchestrator), one new presentation module (PDF export), one extended existing page (no new
page/route), two new dependencies; 3 prioritized user stories, 10 functional requirements (see
[spec.md](spec.md)).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                        | Check                                                                                                                                                                                                                                                                       | Status |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| I. Local-First & Zero-Server                       | Every figure is computed client-side from already-local IndexedDB data via existing `analyticsEngine.ts`/`wealthRepository.ts` functions; jsPDF renders the PDF entirely in-browser with no network call; the file is downloaded via the existing `file-saver`, never uploaded. | PASS   |
| II. Privacy & Encryption by Default                | No new storage — nothing new to encrypt. `CryptoKey` flows through to the existing encrypted repositories exactly as `AnalyticsPage.tsx`/`ExportPage.tsx` already do. The PDF is assembled in-memory from already-decrypted, already-on-screen figures, then downloaded — same trust boundary as the existing CSV/XLSX export, no plaintext logged. | PASS   |
| III. Layered Clean Architecture                    | `reportEngine.ts` is pure (plain data in/out, no repository import, no `async`); `reportService.ts` is the only impure layer and depends only on `analyticsEngine.ts` + `wealthRepository.ts`, never on Dexie directly; `reportPdfExport.ts` consumes only the finished `ReportSummary`, no repository access; `ExportPage.tsx` never imports Dexie.                                          | PASS   |
| IV. Test-First for Financial Logic                 | Not one of the four engines Principle IV names explicitly, but — per the precedent set in specs 002–004, 006, 007 — a derived report that summarizes money still gets the same bar since a wrong figure would misrepresent the user's real financial standing to whoever reads the PDF (including third parties, per spec's "accountant or partner" scenario). Unit tests for every pure function in the contract MUST exist and pass before done. | PASS (process gate, enforced in tasks phase) |
| V. Free & Open-Source Only                         | `jspdf`/`jspdf-autotable` are MIT-licensed, free, client-side-only libraries with no recurring cost and no server dependency (research.md §6) — consistent with the existing `exceljs`/`papaparse`/`file-saver` dependencies this same export flow already uses.        | PASS   |
| VI. Data Integrity & Non-Destructive Operations     | No monetary values are stored by this feature — every figure is recomputed on demand and the PDF itself is a downloaded artifact outside app storage, exactly like the existing CSV/XLSX exports. Read-only feature; no mutation path exists; nothing to soft-delete.  | PASS   |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/report-engine.md, quickstart.md):

- `contracts/report-engine.md` confirms every function in `reportEngine.ts` is synchronous and
  pure (no `CryptoKey` parameter, no repository import), and that `reportService.ts` is the
  only place that calls `analyticsEngine.ts`/`NetWorthSnapshotRepository` — Principle III
  intact.
- `data-model.md`'s relationship diagram confirms no arrow points *into*
  `Transaction`/`TransactionSplit`/`Category`/`NetWorthSnapshot` — this feature only reads
  already-computed aggregates and already-persisted snapshots, never writes — Principle II and
  VI intact (nothing new to encrypt, nothing new to soft-delete).
- research.md §1–3 confirm the report's only three data sources are `incomeExpenseTrend`,
  `categoryBreakdown`, and `NetWorthSnapshotRepository.list` — all pre-existing, all already
  reused elsewhere (Analytics/Net Worth pages) — Principle III's "no divergent calculation"
  concern (which motivated FR-010) is structurally enforced, not just promised. The one
  genuinely new piece of logic, `pickSnapshotAtOrBefore`, is a *selector* over already-computed
  values, not a new calculation of net worth itself (research.md §3).
- research.md §6 confirms `jspdf`/`jspdf-autotable` are the only new dependencies, both
  MIT-licensed, both client-side-only — Principle V and I intact.

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/011-year-in-review-report/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── report-engine.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── budgets/
│   │   └── budgetEngine.ts                   # UNCHANGED: getCurrentPeriodRange() reused as-is
│   │                                            (research.md §4)
│   ├── analytics/
│   │   └── analyticsEngine.ts                # UNCHANGED: incomeExpenseTrend(), categoryBreakdown()
│   │                                            reused as-is (research.md §1-2)
│   └── reports/                              # NEW directory
│       ├── reportEngine.ts                   # NEW: pure functions — resolveReportPeriodRange(),
│       │                                        formatReportPeriodLabel(), isPeriodInProgress(),
│       │                                        topCategories(), pickSnapshotAtOrBefore(),
│       │                                        buildReportSummary()
│       └── reportService.ts                  # NEW: thin orchestrator — generateReportSummary()
│                                                — calls analyticsEngine.ts + wealthRepository.ts,
│                                                never Dexie directly
│
├── data/
│   ├── dexie/
│   │   └── wealthRepository.ts               # UNCHANGED: NetWorthSnapshotRepository.list() reused
│   │                                            as-is (research.md §3)
│   └── io/
│       ├── exportService.ts                  # UNCHANGED: existing CSV/XLSX export, untouched
│       └── reportPdfExport.ts                 # NEW: buildReportPdfBlob(), reportPdfFilename()
│                                                 (jsPDF + jspdf-autotable) — sibling to
│                                                 exportService.ts, same layer
│
└── pages/
    └── ExportPage.tsx                        # EXTENDED: one new Card section (period-type toggle,
                                                 year/month selector, Generate Report, inline
                                                 ReportSummary preview, Download PDF) alongside the
                                                 existing CSV/XLSX buttons (FR-007) — no new route

package.json                                   # EXTENDED: + jspdf, jspdf-autotable dependencies

tests/
├── unit/
│   └── reportEngine.test.ts                  # NEW
├── integration/
│   └── reportPdfExport.test.ts                # NEW
└── e2e/
    └── yearInReviewReport.spec.ts             # NEW
```

**Structure Decision**: Extends the existing single frontend-only project layout unchanged
(see [../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)'s
Structure Decision, reused as-is by specs 002–010). This feature adds one new domain
subdirectory (`domain/reports/`, mirroring the existing pure-engine/thin-orchestrator split
`domain/analytics/` already establishes for spec 007) and one new `data/io/` module alongside
the existing `exportService.ts` it sits beside, plus two new dependencies for PDF generation —
no new architectural layer, no new project, no schema change, no new route.

## Complexity Tracking

_No violations identified — this section is not needed for this plan._
