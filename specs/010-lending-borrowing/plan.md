# Implementation Plan: Personal Lending & Borrowing (IOU) Tracking

**Branch**: `010-lending-borrowing` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/010-lending-borrowing/spec.md`

## Summary

Let a user record money lent to or borrowed from a person, log partial repayments over time,
see a derived pending balance per loan and net position per person, get overdue reminders, and
have net worth correctly include open receivables/payables. Technical approach: three new
Dexie-backed entities (`Person`, `PersonLoan`, `LoanRepayment`) modeled on the derived-balance
pattern spec 003 already proved out for `SavingsGoal`/`GoalContribution`; loan/repayment money
movements post as ordinary single-sided `type: 'transfer'` transactions through the existing
`TransactionEngine`; overdue reminders extend the existing notification orchestrator (spec
004); net worth impact extends the existing single `computeNetWorth` function (spec 001). No
new runtime dependencies; fits the existing React/Dexie/shadcn stack unchanged.

## Technical Context

**Language/Version**: TypeScript 5.x, same evergreen-browser target as the core app (Vite)

**Primary Dependencies**: No new dependencies. Reuses React 19 + React Router, shadcn/ui on
Tailwind CSS, Dexie.js, the existing `TransactionEngine`, and Vitest/Playwright — all already
in the core app's stack (see
[../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md))

**Storage**: IndexedDB via Dexie.js — three new tables (`people`, `personLoans`,
`personLoanRepayments`), added as additive schema version 9; no server-side or cloud storage

**Testing**: Vitest unit tests for the pure loan-progress engine (`computePendingBalance`,
`deriveLoanStatus`, `isLoanOverdue`, `computeNetPositionForPerson`, `computeOpenLoanTotals`,
`validateRepaymentAmount`, `validateWriteOffAmount`, `findOverduePersonLoans`), reconciled by
hand per Constitution Principle IV; a Dexie integration test for the three new repositories
(including FR-007/FR-015/FR-018 rejection paths and the linked-transaction posting/reversal
behavior); a Playwright E2E test for the record-loan → partial-repayment → settle →
People-list/Dashboard-tile flow, plus write-off and the blocked-person-deletion case

**Target Platform**: Same installable PWA (Android/iOS/desktop), fully offline-capable

**Project Type**: Web — single frontend-only project (no backend exists or is planned)

**Performance Goals**: Loan/repayment creation and the People list/Dashboard tile recompute
immediately (perceived as instantaneous), consistent with SC-001/SC-002's sub-30-second and
sub-15-second targets; `computeNetWorth`'s added query (open `PersonLoan`s) must not turn an
already-fast calculation into a slow one — expected scale (tens of loans per installation)
makes this a non-issue, but the query MUST reuse the same non-deleted-index pattern every
other entity list already uses, not a full-table scan with in-memory filtering of deleted rows

**Constraints**: All monetary math stays integer-based (Constitution Principle VI); pending
balance is derived, never persisted (research.md §2), so it can never drift out of sync;
FR-007/FR-015/FR-018 validation MUST be enforced at the repository boundary, not only in the
UI (research.md §6), so the rules hold for any future non-UI caller; loan/repayment money
movements MUST reuse the existing `'transfer'` transaction type rather than introduce a new
`TransactionType` (research.md §1), to avoid touching every exhaustive switch over that union
across the app

**Scale/Scope**: Single user per installation, typically a handful of people with a handful
of loans each; 5 prioritized user stories, 18 functional requirements (see [spec.md](spec.md))

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Check | Status |
| --- | --- | --- |
| I. Local-First & Zero-Server | Pure client-side entities, repositories, and calculation; no server/network call introduced. | PASS |
| II. Privacy & Encryption by Default | `Person`, `PersonLoan`, `LoanRepayment` are stored through the same Dexie/encryption layer (`EncryptedRow`) as every other financial entity — no new plaintext storage path. Linked `Transaction` rows go through the existing, already-encrypted `TransactionRepository`/`TransactionEngine`. | PASS |
| III. Layered Clean Architecture | New `src/domain/personLoans/` engine and new `src/data/dexie/personLoanRepository.ts` depend only on plain data, repository interfaces, and `TransactionEngine` — never on React directly; UI (`PeoplePage.tsx`, Dashboard tile) calls the engine and repositories only, matching the existing pattern in `SavingsGoalsPage.tsx`. | PASS |
| IV. Test-First for Financial Logic | Not one of the four engines named explicitly in Principle IV, but — per the precedent set in specs 002/003/006/007/009's plans — held to the same bar given it directly affects account balances and net worth; unit tests against hand-computed examples, plus integration tests for the repository-boundary validation (FR-007/FR-015/FR-018), MUST exist and pass before the feature is considered done. | PASS (process gate, enforced in tasks phase) |
| V. Free & Open-Source Only | Zero new dependencies added. | PASS |
| VI. Data Integrity & Non-Destructive Operations | All new monetary fields are integers; all three new entities use UUIDs and soft-delete/restore identical to existing entities; pending balance is never persisted, eliminating a whole class of drift bugs; overpayment, non-positive amounts, and deleting a person with open loans are all rejected rather than silently accepted or worked around. | PASS |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/loan-progress-engine.md, quickstart.md):

- `data-model.md` confirms `Person`/`PersonLoan`/`LoanRepayment` use integers for every
  monetary field and UUID primary keys, matching Principle VI exactly.
- `contracts/loan-progress-engine.md` confirms every engine function
  (`computePendingBalance`, `deriveLoanStatus`, `isLoanOverdue`, `computeNetPositionForPerson`,
  `computeOpenLoanTotals`, `validateRepaymentAmount`, `validateWriteOffAmount`,
  `findOverduePersonLoans`) is pure (input in, value out, no I/O, no mutation) — Principle III
  intact.
- The contract's repository interfaces confirm `LoanRepaymentRepository.create` and
  `PersonLoanRepository.create`/`writeOff` call the relevant `validate*` function before
  writing anything, and `PersonRepository.softDelete` checks for open loans before deleting —
  Principle VI's rejection requirements are enforced at the data layer, not left to the UI.
- No new external dependency appears anywhere in data-model.md or the contract — Principle V
  intact.
- `research.md` §1 confirms reusing `type: 'transfer'` requires no change to
  `TransactionRow`/`Transaction`'s shape and no new column — Principle II's "no new plaintext
  storage path" and Principle VI's existing conventions both remain intact through the
  existing `TransactionRepository`.

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/010-lending-borrowing/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── loan-progress-engine.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── personLoans/                   # NEW: pure progress/validation/notification engine
│   │   ├── loanProgress.ts             # computePendingBalance(), deriveLoanStatus(),
│   │   │                                  isLoanOverdue(), computeNetPositionForPerson(),
│   │   │                                  computeOpenLoanTotals(), validateRepaymentAmount(),
│   │   │                                  validateWriteOffAmount(), findOverduePersonLoans()
│   │   └── types.ts                     # LoanStatus, etc.
│   ├── wealth/
│   │   └── wealthEngine.ts              # MODIFIED: computeNetWorth() adds open PersonLoan
│   │                                       totals (computeOpenLoanTotals) to
│   │                                       totalAssets/totalLiabilities
│   └── notifications/
│       └── runNotificationCheck.ts      # MODIFIED: adds findOverduePersonLoans() as a third
│                                            candidate source, reusing NotifiedItemRepository
│
├── data/
│   └── dexie/
│       ├── db.ts                        # EXTENDED: v9 — people, personLoans,
│       │                                    personLoanRepayments tables
│       └── personLoanRepository.ts      # NEW: PersonRepository, PersonLoanRepository,
│                                             LoanRepaymentRepository (each posts/reverses its
│                                             linked Transaction via TransactionEngine)
│
├── pages/
│   ├── PeoplePage.tsx                   # NEW: people list with net position + overdue flag,
│   │                                        record-loan dialog, per-person loan history +
│   │                                        repayment logging + write-off — Stories 1, 2, 3, 5
│   │                                        (no separate detail route, same precedent as
│   │                                        SavingsGoalsPage.tsx: the list already needs full
│   │                                        detail to be useful)
│   ├── DashboardPage.tsx                # MODIFIED: adds the "you're owed / you owe" summary
│   │                                        tile (Story 3, FR-010) via computeOpenLoanTotals()
│   └── TrashPage.tsx                    # MODIFIED: adds deleted People/PersonLoans/
│                                             LoanRepayments sections (FR-016), same pattern as
│                                             its existing Accounts/Transactions/Goals/Rules
│                                             sections
│
└── App.tsx                              # MODIFIED: adds `Route path="people"` (+ nav entry)

tests/
├── unit/
│   ├── loanProgressEngine.test.ts       # NEW: hand-computed pending-balance/status/overdue/
│   │                                        net-position/validation examples
│   └── notificationEngine.test.ts       # EXTENDED: findOverduePersonLoans() cases
├── integration/
│   └── personLoanRepositories.test.ts   # NEW: FR-007/FR-015/FR-018 rejection paths, linked-
│                                             transaction posting/reversal, soft-delete/restore
└── e2e/
    └── personLending.spec.ts            # NEW: record loan → partial repayment → settle →
                                               People list/Dashboard tile; write-off; blocked
                                               person deletion with an open loan
```

**Structure Decision**: Extends the existing single frontend-only project layout unchanged
(see [../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)'s
Structure Decision, reused as-is by specs 002-009). This feature adds one new domain engine
directory, one new repository module, one new page, and extends the existing Dexie schema and
three existing files (`wealthEngine.ts`, `runNotificationCheck.ts`, `TrashPage.tsx`,
`DashboardPage.tsx`, `App.tsx`) — no new architectural layer, no new project. Following spec
003's precedent, Story 3 (People overview) does not get a separate route: the People list
already needs to show every person's net position to be useful, so a combined-total Dashboard
tile plus that list satisfies FR-009/FR-010 without a duplicate screen.

## Complexity Tracking

_Not applicable — Constitution Check identified no violations._
