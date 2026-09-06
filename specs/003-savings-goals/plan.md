# Implementation Plan: Savings Goals

**Branch**: `003-savings-goals` | **Date**: 2026-09-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-savings-goals/spec.md`

## Summary

Users create named savings goals with a target amount and optional target date, manually log
contributions against them, and see progress, a projected completion date (once enough
contribution history exists), and an on-track/behind/achieved status — individually and in a
combined overview. Technical approach: two new Dexie-backed entities (`SavingsGoal`,
`GoalContribution`), a new pure `src/domain/savingsGoals/goalProgress.ts` engine, and a small
shared `src/domain/shared/dateMath.ts` module extracted from the existing debt payoff planner
(spec 002) so both features share one whole-month-arithmetic implementation. No new runtime
dependencies; fits the existing React/Dexie/shadcn stack unchanged.

## Technical Context

**Language/Version**: TypeScript 5.x, same evergreen-browser target as the core app (Vite)

**Primary Dependencies**: No new dependencies. Reuses React 19 + React Router, shadcn/ui on
Tailwind CSS, Dexie.js, and Vitest — all already in the core app's stack (see
[../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md))

**Storage**: IndexedDB via Dexie.js — two new tables, `savingsGoals` and
`goalContributions`; no server-side or cloud storage

**Testing**: Vitest unit tests for the progress/projection engine (reconciled by hand per
Constitution Principle IV's rationale, the same bar spec 002 applied to its payoff engine), a
Dexie integration test for both new repositories (including FR-009's future-date rejection
and the soft-delete/restore behavior), and a Playwright E2E test for the goal-creation,
contribution-logging, and overview flows

**Target Platform**: Same installable PWA (Android/iOS/desktop), fully offline-capable

**Project Type**: Web — single frontend-only project (no backend exists or is planned)

**Performance Goals**: Progress and projection recompute immediately (perceived as
instantaneous, no loading state) as a user logs a contribution or edits a goal, consistent
with SC-002's 20-second goal-to-first-contribution target

**Constraints**: All monetary math stays integer-based (Constitution Principle VI); a
contribution dated in the future MUST be rejected at the repository boundary (FR-009); a
goal's derived status/projection is never persisted, only computed from current contributions
(research.md §5), so it can never drift out of sync with the underlying data

**Scale/Scope**: Single user per installation, typically a handful of goals with tens of
contributions each; 3 prioritized user stories, 9 functional requirements (see
[spec.md](spec.md))

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                       | Check                                                                                                                                                                                                                                                                                         | Status                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| I. Local-First & Zero-Server                    | Pure client-side entities and calculation; no server/network call introduced                                                                                                                                                                                                                  | PASS                                         |
| II. Privacy & Encryption by Default             | `SavingsGoal` and `GoalContribution` are stored through the same Dexie/encryption layer as all other financial data — no new plaintext storage path                                                                                                                                           | PASS                                         |
| III. Layered Clean Architecture                 | New `src/domain/savingsGoals/` engine and the shared `src/domain/shared/dateMath.ts` depend only on plain data and repository interfaces, never on Dexie or React directly; UI calls the engine and repositories only                                                                         | PASS                                         |
| IV. Test-First for Financial Logic              | Not one of the four engines named explicitly in Principle IV, but — per the precedent already set in spec 002's plan — held to the same bar given it performs money-affecting projections; unit tests against hand-computed examples MUST exist and pass before the engine is considered done | PASS (process gate, enforced in tasks phase) |
| V. Free & Open-Source Only                      | Zero new dependencies added                                                                                                                                                                                                                                                                   | PASS                                         |
| VI. Data Integrity & Non-Destructive Operations | New fields are integers; `SavingsGoal` uses UUIDs and soft-delete/restore identical to existing entities; derived status/projection is never persisted, eliminating a whole class of drift bugs; a future-dated contribution is rejected rather than silently accepted                        | PASS                                         |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/goal-progress-engine.md, quickstart.md):

- `data-model.md` confirms `SavingsGoal`/`GoalContribution` use integers for every monetary
  field and UUID primary keys, matching Principle VI exactly.
- `contracts/goal-progress-engine.md` confirms `computeGoalProgress` is a pure function
  (input in, `GoalProgress` out, no I/O, no mutation) — Principle III intact.
- The shared `dateMath.ts` extraction (research.md §2) is a refactor of already-tested code
  from spec 002, not new unproven logic — no drop in test coverage for that feature.
- No new external dependency appears anywhere in data-model.md or the contract — Principle V
  intact.
- Future-dated contributions and non-zero-amount validation are enforced by
  `GoalContributionRepository.create` per the contract, not left to the UI alone — keeps
  FR-009 enforceable even from a future non-UI caller (e.g., import/backup restore).

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/003-savings-goals/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── goal-progress-engine.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── shared/
│   │   └── dateMath.ts               # NEW: addMonthsISO()/monthsBetween(), extracted from
│   │                                     debtPlanner/generatePlan.ts (spec 002) for reuse
│   ├── debtPlanner/
│   │   └── generatePlan.ts            # MODIFIED: imports from shared/dateMath.ts instead of
│   │                                     its own private copies (no behavior change)
│   └── savingsGoals/                  # NEW: pure progress/projection engine
│       ├── goalProgress.ts             # computeGoalProgress()
│       └── types.ts                     # GoalProgress, GoalStatus, etc.
│
├── data/
│   └── dexie/
│       ├── db.ts                       # EXTENDED: savingsGoals, goalContributions tables
│       └── savingsGoalRepository.ts    # NEW: SavingsGoalRepository, GoalContributionRepository
│
├── pages/
│   ├── SavingsGoalsPage.tsx            # NEW: goal list, create/edit dialog, per-goal detail
│   │                                      (progress, contribution log, projection) — Stories 1-2
│   └── (Story 3's overview renders on the same page/list; no separate route needed given
│         the goal list already shows every goal's status at a glance)
└── components/
    └── (reuses existing shadcn/ui primitives; no new shared components anticipated)

tests/
├── unit/
│   └── goalProgressEngine.test.ts      # NEW: hand-computed projection/status examples
├── integration/
│   └── savingsGoalRepositories.test.ts # NEW: FR-009 validation, soft-delete/restore
└── e2e/
    └── savingsGoals.spec.ts            # NEW
```

**Structure Decision**: Extends the existing single frontend-only project layout unchanged
(see [../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)'s
Structure Decision, also reused as-is by
[../002-debt-payoff-planner/plan.md](../002-debt-payoff-planner/plan.md)). This feature adds
one new shared domain utility, one new domain engine directory, one new repository module,
one new page, and extends the existing Dexie schema — no new architectural layer, no new
project. Story 3 (Goals Overview) does not get its own route: since Story 1's goal list
already needs to show every goal's status to be useful at all, a separate overview screen
would just duplicate it — the list itself, plus a combined-total header, satisfies FR-008.
