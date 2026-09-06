# Implementation Plan: Debt Payoff Planner

**Branch**: `002-debt-payoff-planner` | **Date**: 2026-09-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-debt-payoff-planner/spec.md`

## Summary

A read-only, derived planning view on top of the existing Liability entity: the user picks
an avalanche or snowball payoff strategy and an optional extra monthly payment, and the app
simulates a month-by-month payoff schedule — showing per-debt and overall payoff dates,
total interest, and a side-by-side strategy comparison. Technical approach: extend
`Liability` with two new optional fields (`interestRate`, `minimumPayment`), add a small new
`src/domain/debtPlanner/` engine (pure TypeScript simulation, no new dependencies) consumed
by a new page in the existing React/Dexie/shadcn stack, plus a tiny new
`DebtPlannerPreference` singleton table to remember the user's last strategy/extra-payment
choice. No backend, no new runtime dependency, no change to existing money-affecting engines.

## Technical Context

**Language/Version**: TypeScript 5.x, same evergreen-browser target as the core app (Vite)

**Primary Dependencies**: No new dependencies. Reuses React 19 + React Router, shadcn/ui on
Tailwind CSS, Dexie.js, and Vitest — all already in the core app's stack (see
[../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md))

**Storage**: IndexedDB via Dexie.js — extends the existing `Liability` table (two new
nullable columns) and adds one new singleton table, `DebtPlannerPreference`; no server-side
or cloud storage

**Testing**: Vitest unit tests for the payoff-simulation engine (reconciled against
hand-built amortization tables, per Constitution Principle IV), a Dexie integration test for
the new preference repository, and a Playwright E2E test for the planner UI flow

**Target Platform**: Same installable PWA (Android/iOS/desktop), fully offline-capable —
this feature makes no network calls

**Project Type**: Web — single frontend-only project (no backend exists or is planned)

**Performance Goals**: Recalculating the plan after an input change (strategy or extra
payment) completes in under 1 second (spec SC-004), even at a worst-case 600-month
simulation cap per liability

**Constraints**: Must never mutate a stored `Liability` record — the plan is purely derived
and recomputed on read (spec FR-007); all rate/amount math MUST use integers (basis points
for rates, smallest currency unit for amounts) to avoid floating-point drift, consistent
with Constitution Principle VI's existing monetary-integer rule

**Scale/Scope**: Single user per installation, typically fewer than 20 liabilities; 3
prioritized user stories, 10 functional requirements (see [spec.md](spec.md))

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                       | Check                                                                                                                                                                                                                                                                                                                                                                 | Status                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| I. Local-First & Zero-Server                    | Pure client-side calculation over existing local data; no server/network call introduced                                                                                                                                                                                                                                                                              | PASS                                         |
| II. Privacy & Encryption by Default             | New `Liability` fields and the new `DebtPlannerPreference` table are stored through the same Dexie/encryption layer as all other financial data — no new plaintext storage path                                                                                                                                                                                       | PASS                                         |
| III. Layered Clean Architecture                 | New `src/domain/debtPlanner/` engine depends only on the existing `LiabilityRepository` interface and a new `DebtPlannerPreferenceRepository` interface, never on Dexie directly; UI calls the engine, not storage                                                                                                                                                    | PASS                                         |
| IV. Test-First for Financial Logic              | Although not one of the four engines named explicitly in Principle IV, this engine performs money-affecting projections; per the principle's rationale ("silent financial miscalculation is the most damaging failure mode"), it is held to the same bar — unit tests against hand-built amortization tables MUST exist and pass before the engine is considered done | PASS (process gate, enforced in tasks phase) |
| V. Free & Open-Source Only                      | Zero new dependencies added                                                                                                                                                                                                                                                                                                                                           | PASS                                         |
| VI. Data Integrity & Non-Destructive Operations | New fields are integers (basis points for rate, smallest unit for payment amounts); the plan itself is never persisted as a competing source of truth, only derived; `Liability` soft-delete behavior is unaffected                                                                                                                                                   | PASS                                         |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/debt-payoff-engine.md, quickstart.md):

- `data-model.md` confirms `interestRate`/`minimumPayment` are integers (basis points /
  smallest currency unit respectively) — Principle VI intact.
- `contracts/debt-payoff-engine.md` confirms the engine is a pure function that never
  mutates its `Liability` input and never calls a repository write method — Principle III
  and FR-007 both intact.
- No new external dependency appears anywhere in data-model.md or the contract — Principle V
  intact.
- The non-converging case (FR-010) is handled by returning a flagged result rather than an
  unbounded loop or a thrown error, keeping the UI layer free of ad-hoc error handling for a
  case the domain layer should own.

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/002-debt-payoff-planner/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── debt-payoff-engine.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── domain/
│   └── debtPlanner/                 # NEW: pure simulation engine
│       ├── generatePlan.ts           # generateDebtPayoffPlan(), compareStrategies()
│       └── types.ts                    # DebtPayoffPlan, DebtPayoffPlanEntry, etc.
│
├── data/
│   ├── repositories/
│   │   └── debtPlannerPreferenceRepository.ts   # NEW: interface + Dexie implementation
│   └── dexie/
│       └── schema.ts                              # EXTENDED: Liability columns, new table
│
├── pages/
│   └── DebtPayoffPlannerPage.tsx     # NEW: strategy picker, extra-payment input, plan view,
│                                        comparison view (Stories 1-3)
└── components/
    └── (reuses existing shadcn/ui primitives; no new shared components anticipated)

tests/
├── unit/
│   └── debtPayoffEngine.test.ts       # NEW: reconciles engine output against hand-built
│                                          amortization tables (Constitution Principle IV)
├── integration/
│   └── debtPlannerPreferenceRepository.test.ts   # NEW
└── e2e/
    └── debtPayoffPlanner.spec.ts      # NEW
```

**Structure Decision**: Extends the existing single frontend-only project layout unchanged
(see [../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)'s
Structure Decision). This feature adds one new domain engine directory, one new repository,
one new page, and extends the existing Dexie schema — it introduces no new architectural
layer and no new project.
