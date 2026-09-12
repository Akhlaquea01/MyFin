# Implementation Plan: Multi-Account Transaction Import

**Branch**: `009-multi-account-import` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/009-multi-account-import/spec.md`

## Summary

Extend the existing CSV/XLSX file import (`src/data/io/importService.ts`,
`src/pages/ImportPage.tsx`) so a user can optionally designate one column as an account
indicator, routing each row to the account named in that column instead of requiring every
row to go to one pre-selected account. Rows with a blank or unrecognized account value are
skipped and reported per-row (matching today's malformed-row handling); if an account name
used anywhere in the file matches more than one existing account, the entire import is
blocked up front — nothing is imported — because the app does not currently enforce unique
account names and silently guessing which account was meant is unacceptable (FR-006).
Archived accounts are valid match targets, same as active ones (FR-003). No new persisted
entity or Dexie schema change is needed: `accountColumn` is a transient field on the
existing in-memory `ColumnMapping` used only for the duration of one import.

## Technical Context

**Language/Version**: TypeScript (per `package.json`), Vite 8, React 19 — same stack as the
rest of the app, no version changes.

**Primary Dependencies**: No new dependencies. Reuses Papa Parse and ExcelJS (existing file
parsing), Dexie.js (`AccountRepository`, `TransactionRepository`), the existing
`TransactionEngine`, and Vitest/Playwright for testing — all already present.

**Storage**: IndexedDB via Dexie.js — no schema change. `ColumnMapping.accountColumn` and the
resolved per-row account id are transient, in-memory values used only while an import is in
progress; nothing new is persisted, so no `db.version()` bump is required.

**Testing**: Vitest unit tests for the new pure account-resolution/collision-detection helpers
and for `importRows()`'s multi-account behavior (extends `tests/unit/importService.test.ts`);
a Playwright scenario extending `tests/e2e/importExportBackup.spec.ts` (or a new spec file) for
the end-to-end multi-account import flow, including the blocked-on-collision case.

**Target Platform**: Same installable PWA (Android/iOS/desktop); no platform-specific
behavior — this is a client-side data/logic and single-page UI change.

**Project Type**: Web — single frontend-only project (no backend exists or is planned).

**Performance Goals**: Must not change the existing `MAX_IMPORT_ROWS` (20,000) ceiling or the
existing "yield to the event loop every 100 rows" behavior. Must not turn the existing
O(rows + one account's existing transactions) duplicate-detection cost into O(rows × all
accounts' existing transactions) — the per-account duplicate index has to stay something built
once per *touched* account, not once per row or once for every account regardless of use.

**Constraints**: Backward compatible — when no account column is mapped, `importRows()` and
the UI behave exactly as they do today (FR-002). Account-name collision detection (FR-006)
MUST run as a pre-pass before any transaction is created, so a blocked import creates zero
rows rather than partially committing. Account matching is by name only (case-insensitive,
whitespace-trimmed), including archived accounts (FR-003) — no ID-based matching, since
account ids are opaque UUIDs a user would not have in a source file.

**Scale/Scope**: Same `MAX_IMPORT_ROWS` (20,000) ceiling; a file is expected to reference a
small number of distinct accounts (typically 2-5). 3 prioritized user stories, 9 functional
requirements (see [spec.md](spec.md)).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Check | Status |
| --- | --- | --- |
| I. Local-First & Zero-Server | Account resolution and collision detection run entirely client-side against already-loaded `Account[]` data; no network call introduced. | PASS |
| II. Privacy & Encryption by Default | `accountColumn` and the resolved account id are transient in-memory values for the duration of one import, never written to storage in any new form. Accounts and transactions continue through the existing encrypted `AccountRepository`/`TransactionRepository`/`TransactionEngine` path unchanged. | PASS |
| III. Layered Clean Architecture | New logic is a set of pure helper functions in `src/data/io/importService.ts` (same file/layer as the existing `parseDateWithFormat`/`parseAmount` pure helpers) plus an extension of `importRows()`'s existing orchestration; `ImportPage.tsx` continues to call only `importService.ts` and `AccountRepository`, never Dexie directly. No new cross-layer dependency. | PASS |
| IV. Test-First for Financial Logic | Account resolution determines which account's balance a transaction affects — a misrouted import silently distorts two account balances. Per the precedent set for auto-categorization (specs 002-004, 006), this is held to the same test-first bar even though `importService.ts` isn't one of the four named engines: unit tests for name matching, collision detection, and the per-account duplicate/balance logic MUST exist and pass before the feature is done. | PASS (process gate, enforced in tasks phase) |
| V. Free & Open-Source Only | Zero new dependencies. | PASS |
| VI. Data Integrity & Non-Destructive Operations | Collision detection (FR-006) is itself an integrity gate that runs before any row is committed, extending the existing "duplicate detection before committing" principle to account-name ambiguity. Monetary values, UUIDs, and soft-delete conventions are all inherited unchanged from the existing transaction/account model. | PASS |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/import-account-resolution.md,
quickstart.md):

- `contracts/import-account-resolution.md` confirms `resolveAccountForRow` and
  `findAccountNameCollisions` are pure (no I/O, no mutation) and that `importRows()` remains
  the only impure orchestrator touching `TransactionRepository`/`TransactionEngine` —
  Principle III intact.
- `data-model.md` confirms no new persisted entity or Dexie table is introduced; the only
  additions are two optional in-memory fields (`ColumnMapping.accountColumn`,
  `ImportResult.perAccountSummary`) — Principle II intact, no new plaintext storage path.
- No new external dependency appears anywhere in data-model.md or the contract — Principle V
  intact.
- The pre-pass collision check in `contracts/import-account-resolution.md` confirms zero
  transactions are created for a blocked import (an all-or-nothing check before the existing
  per-row loop begins) — Principle VI intact, consistent with the existing
  `MAX_IMPORT_ROWS` pre-check that also throws before any row is processed.

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/009-multi-account-import/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── import-account-resolution.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created here)
```

Pre-existing files `architecture.md`, `checklist.md`, and `test-cases.md` in this directory
predate the Spec Kit workflow. They originally sketched an earlier, since-superseded design
(ID-based account matching, silent first-match on ambiguous names, no archived-account
handling) and have been updated to match this plan's finalized design (name-only matching,
archived accounts eligible, whole-file collision blocking) so they stay consistent with
`spec.md`/`research.md`/`data-model.md`/`contracts/` rather than contradicting them.

### Source Code (repository root)

```text
src/
├── data/
│   └── io/
│       └── importService.ts        # EXTENDED: ColumnMapping.accountColumn (new, optional);
│                                       new pure resolveAccountForRow(), findAccountNameCollisions()
│                                       helpers; importRows() gains an `accounts` parameter, a
│                                       pre-pass collision check, per-account duplicate-index
│                                       and balance-recalc handling, and ImportResult.perAccountSummary
└── pages/
    └── ImportPage.tsx               # EXTENDED: fetches accounts including archived; new
                                        "Account column (optional)" selector; conditional
                                        fallback Account selector; preview shows resolved
                                        account per row and a collision banner that disables
                                        Import; result card shows a per-account breakdown

tests/
├── unit/
│   └── importService.test.ts        # EXTENDED: resolveAccountForRow, findAccountNameCollisions,
│                                        multi-account importRows() behavior
└── e2e/
    └── importExportBackup.spec.ts    # EXTENDED (or a new sibling spec): multi-account import
                                         happy path + blocked-on-collision scenario
```

**Structure Decision**: Extends the existing single frontend-only project layout unchanged
(see [../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)'s
Structure Decision, reused as-is by specs 002-008). This feature touches exactly two existing
source files and their tests — no new directory, no new architectural layer, no new project.
