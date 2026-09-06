# Implementation Plan: Financial Health Insights

**Branch**: `007-financial-health-insights` | **Date**: 2026-09-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-financial-health-insights/spec.md`

## Summary

A new read-only insights page shows savings rate, expense-to-income ratio, budget adherence,
a multi-month trend, and a composite 0–100 health score — all derived entirely from data the
ledger and budgeting features already compute, with zero new persisted entities. Technical
approach: a new pure `financialHealthEngine.ts` (the actual ratio/score math, no I/O) plus a
thin `financialHealthService.ts` orchestrator that calls the *existing*
`incomeExpenseTrend()`/`budgetPerformance()` functions from `analyticsEngine.ts` rather than
re-querying the ledger — the only way to durably guarantee this panel never disagrees with
Analytics/Budgets (FR-007). A new `FinancialHealthPage.tsx` reuses the existing
`DateRangeSelector` and the same Chart.js trend-rendering pattern `AnalyticsPage.tsx` already
uses, plus one new nav item (`/financial-health`, sidebar, between Net Worth and Analytics) —
which alone satisfies "within 2 clicks of the dashboard" (SC-002), since the sidebar is present
on every page.

## Technical Context

**Language/Version**: TypeScript 5.x, same evergreen-browser target as the core app (Vite)

**Primary Dependencies**: No new dependencies. Reuses React 19 + React Router, shadcn/ui on
Tailwind CSS, Chart.js (already a dependency via `AnalyticsPage.tsx`), Dexie.js, and Vitest —
see [../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md).

**Storage**: IndexedDB via Dexie.js — no new table, no schema version bump. This feature reads
existing `transactions`, `transactionSplits`, `budgets`, and `budgetItems` tables only through
the existing `analyticsEngine.ts` functions (`incomeExpenseTrend`, `budgetPerformance`); it
never queries Dexie directly and never writes anything (data-model.md, research.md §7).

**Testing**: Vitest unit tests for the pure functions in `financialHealthEngine.ts` (ratio
null-guards, budget-adherence percentage/edge-cases, composite score weighting/direction/
data-quality boundaries — contracts/financial-health-engine.md) and a Playwright E2E test
covering the single-period card, the trend chart, and the composite score's directional
movement (quickstart.md Scenarios 1, 4, 5).

**Target Platform**: Same installable PWA (Android/iOS/desktop); no platform-specific
behavior — pure client-side derived view, one new route.

**Project Type**: Web — single frontend-only project (no backend exists or is planned)

**Performance Goals**: Same cost class as the existing Analytics page it sits beside — one
`incomeExpenseTrend`/`budgetPerformance` call pair per range selection, not per-row/per-render;
no new N-queries-per-item pattern introduced anywhere a list renders.

**Constraints**: Every ratio-based figure MUST render "not applicable" rather than a computed
value when income is `<= 0` (FR-003); budget adherence and the composite score MUST NOT treat
"no active budgets" as a penalty (Edge Cases, FR-006); every figure MUST be derived from, and
therefore never able to drift from, the existing Analytics/Budgets totals (FR-007).

**Scale/Scope**: Single user per installation; one new page, one new pure engine module, one
new thin orchestrator module, one new nav item; 3 prioritized user stories, 7 functional
requirements (see [spec.md](spec.md)).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                        | Check                                                                                                                                                                                                                                        | Status |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| I. Local-First & Zero-Server                       | Every figure is computed client-side from already-local IndexedDB data via existing `analyticsEngine.ts` functions; no network call introduced.                                                                                              | PASS   |
| II. Privacy & Encryption by Default                | No new storage at all — nothing new to encrypt or leak. The `CryptoKey` is passed through to the existing encrypted repositories exactly as `AnalyticsPage.tsx` already does; no plaintext figure is logged (reuses existing render paths). | PASS   |
| III. Layered Clean Architecture                    | `financialHealthEngine.ts` is pure (plain numbers/objects in, plain numbers/objects out, no repository import); `financialHealthService.ts` is the only impure layer and depends only on the existing `analyticsEngine.ts` functions, never on Dexie directly; `FinancialHealthPage.tsx` never imports Dexie.                    | PASS   |
| IV. Test-First for Financial Logic                 | Not one of the four engines Principle IV names explicitly, but — per the precedent set in specs 002/003/004/006 — held to the same bar since a wrong ratio/score would misrepresent the user's real financial standing; unit tests for every pure function in the contract MUST exist and pass before done. | PASS (process gate, enforced in tasks phase) |
| V. Free & Open-Source Only                         | Zero new dependencies; reuses Chart.js already vendored for Analytics.                                                                                                                                                                        | PASS   |
| VI. Data Integrity & Non-Destructive Operations     | No monetary values are stored by this feature at all — every figure is recomputed on demand, so there is nothing here that could go stale, need a soft-delete, or need duplicate detection. Read-only feature; no mutation path exists.       | PASS   |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/financial-health-engine.md, quickstart.md):

- `contracts/financial-health-engine.md` confirms every function in `financialHealthEngine.ts`
  is synchronous and pure (no `CryptoKey` parameter, no repository import, no `async`), and
  that `financialHealthService.ts` is the only place that calls into `analyticsEngine.ts` —
  Principle III intact.
- `data-model.md` confirms zero new Dexie tables/fields and explicitly diagrams that no
  arrow points *into* `Transaction`/`Budget`/`BudgetItem` — this feature only reads already-
  computed aggregates, never writes — Principle II and VI intact (nothing new to encrypt,
  nothing new to soft-delete).
- research.md §1–3 confirm the engine's only two data sources are the existing
  `incomeExpenseTrend`/`budgetPerformance` functions, with the exact same "over budget"
  comparison (`actualAmount > plannedAmount`) `AnalyticsPage.tsx` already uses — Principle III's
  "no divergent calculation" concern (which motivated FR-007) is structurally enforced, not
  just promised.
- No new external dependency appears anywhere in data-model.md or the contract — Principle V
  intact.

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/007-financial-health-insights/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── financial-health-engine.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── domain/
│   └── analytics/
│       ├── analyticsEngine.ts               # UNCHANGED: incomeExpenseTrend(), budgetPerformance()
│       │                                       reused as-is (research.md §1-2)
│       ├── financialHealthEngine.ts         # NEW: pure ratio/adherence/score functions
│       │                                       (computeSavingsRate, computeExpenseToIncomeRatio,
│       │                                       computeBudgetAdherence, buildMonthlyMetrics,
│       │                                       computeFinancialHealthScore)
│       └── financialHealthService.ts        # NEW: thin orchestrator
│                                               (getFinancialHealthTrend, getFinancialHealthScore)
│                                               — calls analyticsEngine.ts, never Dexie directly
│
├── components/
│   └── AppShell.tsx                          # EXTENDED: one new NAV_ITEMS entry
│                                               ('/financial-health', between Net Worth and
│                                               Analytics)
│
└── pages/
    └── FinancialHealthPage.tsx               # NEW: single-period cards (Story 1), trend chart
                                                 reusing DateRangeSelector + the AnalyticsPage.tsx
                                                 Chart.js pattern (Story 2), composite score card
                                                 with breakdown (Story 3)

App.tsx                                        # EXTENDED: one new <Route path="financial-health">

tests/
├── unit/
│   └── financialHealthEngine.test.ts         # NEW
└── e2e/
    └── financialHealthInsights.spec.ts        # NEW
```

**Structure Decision**: Extends the existing single frontend-only project layout unchanged
(see [../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)'s
Structure Decision, reused as-is by specs 002–006). This feature adds two new domain modules
(one pure, one thin orchestrator) inside the existing `domain/analytics/` directory alongside
the engine it reuses, one new page, and one new route/nav entry — no new architectural layer,
no new project, no schema change.
