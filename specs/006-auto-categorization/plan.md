# Implementation Plan: Auto-Categorization Rules & Learning

**Branch**: `006-auto-categorization` | **Date**: 2026-09-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-auto-categorization/spec.md`

## Summary

Users define explicit rules ("merchant X → category Y, tags Z") that pre-fill category/tags
on every newly proposed transaction from Quick Add, bulk text import, or file import, before
it reaches the review queue. Independently, the app tracks which category the user actually
confirms each merchant's transactions into and, once a merchant shows a consistent streak of
confirmations to the same category, starts pre-filling that category too — visibly marked as
a suggestion and always overridden by an explicit rule when both apply. Technical approach: a
new `CategorizationRule` table and a `MerchantCategorySignal` table (one row per merchant, a
capped ring buffer of recent confirmed categories); a new pure `categorizationEngine.ts`
(rule precedence + streak-derivation) plus a thin `resolveCategorization`/`recordConfirmation`
orchestrator called from the single existing choke point all three entry paths already share,
`TransactionEngine.recordTransaction`; a new `TransactionEngine.confirmTransaction` wrapper
that both confirms a transaction and feeds its final category back into the learning signal;
and a small provenance field added to `TransactionSplit` so the UI can badge a suggestion
distinctly from a rule. File import gains merchant resolution for the first time (it
currently has none), and the Review Queue gains its first category/tag editing UI.

## Technical Context

**Language/Version**: TypeScript 5.x, same evergreen-browser target as the core app (Vite)

**Primary Dependencies**: No new dependencies. Reuses React 19 + React Router, shadcn/ui on
Tailwind CSS, Dexie.js, and Vitest — all already in the core app's stack (see
[../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)).

**Storage**: IndexedDB via Dexie.js — two new encrypted tables, `categorizationRules` and
`merchantCategorySignals`; no server-side or cloud storage. `TransactionSplit` gains one new
optional field (`categorizationSource`) carried inside its existing encrypted blob — no Dexie
schema/version bump required for that part, since it isn't an indexed column.

**Testing**: Vitest unit tests for the pure `pickBestRule`/`deriveSuggestion` functions
(precedence ordering, streak boundaries, the "inconsistent history" edge case), a Dexie
integration test for `CategorizationRuleRepository`/`MerchantCategorySignalRepository` and
the `resolveCategorization`/`recordConfirmation` orchestrator against all three entry paths,
and a Playwright E2E test covering rule creation → pre-fill → confirm, and the learn →
suggest → override/promote/reset lifecycle.

**Target Platform**: Same installable PWA (Android/iOS/desktop); no platform-specific
behavior — this feature is pure client-side data/logic plus two new UI surfaces.

**Project Type**: Web — single frontend-only project (no backend exists or is planned)

**Performance Goals**: Rule/suggestion resolution runs once per newly proposed transaction
(single-row `merchantId`-indexed lookups), not per-row in any list view — it must not
reintroduce an N-queries-per-render cost anywhere a transaction list already renders.

**Constraints**: An explicit rule MUST always take precedence over a learned suggestion
(FR-005); a learned suggestion MUST NOT appear before a defined minimum consecutive-
confirmation streak is reached (FR-008, SC-003); a rule whose target category was soft-
deleted MUST stop applying without needing a separate repair step before it can be safely
ignored (FR-009); no already-confirmed transaction is ever retroactively modified.

**Scale/Scope**: Single user per installation; a handful of rules and merchant signals
relative to the merchant catalog; 3 prioritized user stories, 9 functional requirements (see
[spec.md](spec.md)).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                       | Check                                                                                                                                                                                                                                                                              | Status |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| I. Local-First & Zero-Server                     | Rule matching and the learning signal are computed entirely client-side against local IndexedDB data; no network call introduced.                                                                                                                                                 | PASS   |
| II. Privacy & Encryption by Default              | `CategorizationRule` and `MerchantCategorySignal` are stored through the same Dexie/AES-GCM encryption layer as every other table; the new `TransactionSplit.categorizationSource` field rides inside that entity's existing encrypted blob — no new plaintext storage path.      | PASS   |
| III. Layered Clean Architecture                  | `src/domain/categorization/categorizationEngine.ts`'s precedence/streak functions are pure (plain data in, decision out); the orchestrator depends only on repository interfaces; UI (`CategorizationRulesPage`, `ReviewPage`) never touches Dexie directly.                     | PASS   |
| IV. Test-First for Financial Logic               | Not one of the four engines Principle IV names explicitly, but — per the precedent set in specs 002-004 — held to the same bar since mis-categorization silently distorts budget/report totals; `pickBestRule`/`deriveSuggestion` unit tests MUST exist and pass before done.    | PASS (process gate, enforced in tasks phase) |
| V. Free & Open-Source Only                       | Zero new dependencies.                                                                                                                                                                                                                                                             | PASS   |
| VI. Data Integrity & Non-Destructive Operations  | `CategorizationRule` is soft-deletable (Trash/undo, consistent with `SavingsGoal`'s precedent); overriding a pre-fill never rewrites an already-confirmed transaction (FR-007); a stale rule is skipped at match time rather than silently mutated or force-applied (FR-009).    | PASS   |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/categorization-engine.md, quickstart.md):

- `contracts/categorization-engine.md` confirms `pickBestRule` and `deriveSuggestion` are pure
  (no I/O, no mutation) and that the impure orchestrator (`resolveCategorization`,
  `recordConfirmation`) is the only place that reads/writes `CategorizationRule`/
  `MerchantCategorySignal` rows — Principle III intact.
- `data-model.md` confirms both new tables are `EncryptedRow`-shaped like every other
  financial table, and that `TransactionSplit.categorizationSource` is plaintext-inside-
  ciphertext exactly like every other split field — Principle II intact.
- No new external dependency appears anywhere in data-model.md or the contract — Principle V
  intact.
- `CategorizationRuleRepository.softDelete`/`restore` follow the exact same shape as
  `SavingsGoalRepository`'s, and rule invalidation (FR-009) is computed at read/match time
  from the referenced `Category.deletedAt` rather than stored as a separate mutable flag,
  matching the "derived, never stored" precedent `SavingsGoal`'s progress already set —
  Principle VI intact, no destructive/irreversible step introduced.

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/006-auto-categorization/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── categorization-engine.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── categorization/                      # NEW: pure precedence/streak engine
│   │   ├── categorizationEngine.ts           # pickBestRule(), deriveSuggestion()
│   │   ├── resolveCategorization.ts           # impure orchestrator (reads rules/signal)
│   │   └── types.ts                            # CategorizationResult, RuleCandidate, etc.
│   ├── transactions/
│   │   └── transactionEngine.ts               # EXTENDED: recordTransaction() calls
│   │                                              resolveCategorization() when splits are
│   │                                              empty and merchantId is set; NEW
│   │                                              confirmTransaction() confirms + calls
│   │                                              recordConfirmation()
│   └── parser/
│       └── merchantResolver.ts                 # EXTENDED: resolveMerchant() now returns
│                                                  { merchantId, aliasId } instead of a bare
│                                                  string (research.md §1)
│
├── data/
│   ├── dexie/
│   │   ├── db.ts                               # EXTENDED: categorizationRules,
│   │   │                                          merchantCategorySignals tables (v6)
│   │   ├── categorizationRuleRepository.ts     # NEW: CategorizationRuleRepository
│   │   ├── merchantCategorySignalRepository.ts # NEW: MerchantCategorySignalRepository
│   │   └── transactionRepository.ts            # EXTENDED: SplitInput/TransactionSplit
│   │                                              carry categorizationSource
│   └── io/
│       ├── backupService.ts                    # EXTENDED: two new tables included
│       ├── bulkTextImportService.ts             # EXTENDED: uses the new resolveMerchant()
│       │                                          return shape (no behavior change beyond
│       │                                          that plumbing — pre-fill itself happens
│       │                                          inside recordTransaction)
│       └── importService.ts                     # EXTENDED: resolves a Merchant per row for
│                                                    the first time (research.md §4)
│
└── pages/
    ├── QuickAddPage.tsx                        # EXTENDED: uses the new resolveMerchant()
    │                                              return shape
    ├── ReviewPage.tsx                           # EXTENDED: shows the pre-filled category/
    │                                              tags (with a "Suggested" badge per
    │                                              FR-004), lets the user edit before
    │                                              confirming, calls confirmTransaction()
    └── CategorizationRulesPage.tsx              # NEW: rule CRUD (Story 1) + learned-
                                                    suggestions list with Promote/Reset
                                                    actions (Stories 2-3)

tests/
├── unit/
│   └── categorizationEngine.test.ts            # NEW
├── integration/
│   └── categorizationRepositories.test.ts       # NEW
└── e2e/
    └── autoCategorization.spec.ts                # NEW
```

**Structure Decision**: Extends the existing single frontend-only project layout unchanged
(see [../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)'s
Structure Decision, reused as-is by specs 002-005). This feature adds one new domain engine
directory, two new repository modules, one new page, and extends the Dexie schema plus five
existing files (`transactionEngine.ts`, `merchantResolver.ts`, `transactionRepository.ts`,
`backupService.ts`, `bulkTextImportService.ts`, `importService.ts`, `QuickAddPage.tsx`,
`ReviewPage.tsx`) — no new architectural layer, no new project.
