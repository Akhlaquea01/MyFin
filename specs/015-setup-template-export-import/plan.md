# Implementation Plan: Complete Data Template Export & Import

**Branch**: `015-setup-template-export-import` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/015-setup-template-export-import/spec.md`

## Summary

Let a user export every kind of data the app tracks — accounts, categories, merchants, tags,
transactions, budgets, recurring rules, investments, liabilities, net worth history, savings
goals, categorization rules, notification preferences, and receipt attachments — into a
single, human-readable, unencrypted JSON file, and import that file back in, additively and
non-destructively (never overwriting or deleting existing data), distinct from the app's
existing full **encrypted**, all-or-nothing-replace backup/restore. Technical approach: one
new data-layer module (`src/data/io/templateService.ts`, alongside the existing
`backupService.ts`/`importService.ts`/`exportService.ts`) that reads every entity through its
existing repository, assembles/parses one JSON container, and imports in dependency order with
an id-remap table so cross-references resolve correctly whether a record is matched to an
existing one or freshly created. Transactions reuse the app's existing duplicate-transaction
rule (flag, don't skip) rather than the skip-if-exists rule used for everything else. No new
runtime dependencies; no new Dexie schema.

## Technical Context

**Language/Version**: TypeScript 5.x, same evergreen-browser target as the core app (Vite)

**Primary Dependencies**: No new dependencies. `JSON.stringify`/`JSON.parse` (built-in) replace
the CSV/XLSX-specific libraries (Papa Parse/ExcelJS) used by the existing exports for this
feature's own file format. Reuses every existing repository, `TransactionEngine`, and
Vitest/Playwright — all already in the core app's stack (see
[../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md))

**Storage**: IndexedDB via Dexie.js — no schema change. This feature only reads and writes
through existing repositories/tables; the portable file itself lives outside the app (a
downloaded/re-uploaded artifact), never persisted as its own Dexie row.

**Testing**: Vitest unit tests for the pure parts (`parseDataTemplate`'s validation/rejection
cases, the extracted `duplicateKey`/`findDuplicateId` reuse, per-entity match-key resolution
logic); a Dexie integration test for `importDataTemplate` covering skip-if-exists, the
transaction flag-not-skip rule, unresolved-relationship handling, and the attachment/
resolved-duplicate interaction (data-model.md); a Playwright E2E test for export → fresh-install
import → re-import-into-populated-app, matching quickstart.md's scenarios.

**Target Platform**: Same installable PWA (Android/iOS/desktop); no platform-specific behavior

**Project Type**: Web — single frontend-only project (no backend exists or is planned)

**Performance Goals**: Export and import of a large dataset (thousands of transactions, their
attachments, years of net worth history) MUST NOT freeze the UI (FR-014/SC-005). Import MUST
NOT turn into an O(transactions × existing transactions) operation for balance recalculation —
`deferBalance` plus one recalculation per touched account at the end (research.md §6) keeps it
O(imported + existing) per account, matching the discipline already established for bulk file
import (spec 001) and multi-account import (spec 009).

**Constraints**: Import MUST NOT overwrite or delete any existing record under any
circumstance (FR-012) — this is the property that most distinguishes this feature from the
existing full backup's destructive replace-everything restore. The exported file MUST remain
unencrypted and MUST NOT contain `UserProfile`/security credentials (FR-004), consistent with
research.md §1's reasoning that this is a deliberate, already-precedented user-export action,
not a new gap in Constitution Principle II. All monetary fields stay integer, smallest-
currency-unit (Principle VI).

**Scale/Scope**: Single user per installation; a template may contain anywhere from zero
records to a full multi-year transaction history with attachments. 3 prioritized user
stories, 14 functional requirements (see [spec.md](spec.md)).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Check | Status |
| --- | --- | --- |
| I. Local-First & Zero-Server | Pure client-side read/serialize/parse/write; the file is downloaded to and re-uploaded from the user's own device, no network call introduced. | PASS |
| II. Privacy & Encryption by Default | The exported file is deliberately unencrypted, but only because the user explicitly requests and downloads it — research.md §1 establishes this is consistent with the already-shipped, already-unencrypted CSV/XLSX transaction export, not a new deviation. `UserProfile`/security credentials are explicitly excluded (FR-004). All in-app storage this feature touches continues through the existing encrypted repository layer unchanged. | PASS |
| III. Layered Clean Architecture | New `src/data/io/templateService.ts` sits in the same layer as `backupService.ts`/`importService.ts`/`exportService.ts`, calling only repositories and `TransactionEngine`, never Dexie tables directly; `ExportPage.tsx` calls only `templateService.ts`. No new cross-layer dependency. | PASS |
| IV. Test-First for Financial Logic | Not one of the four engines named explicitly in Principle IV, but — per the precedent set in specs 002/003/006/007/009/010's plans — held to the same bar given it creates transactions and recalculates account balances; unit + integration tests covering every skip/create/flag/unresolved-relationship path MUST exist and pass before the feature is considered done. | PASS (process gate, enforced in tasks phase) |
| V. Free & Open-Source Only | Zero new dependencies — uses built-in `JSON.stringify`/`JSON.parse`. | PASS |
| VI. Data Integrity & Non-Destructive Operations | Import never overwrites or deletes an existing record (FR-012) — the strongest form of this principle's "non-destructive" requirement yet applied to an import path. Duplicate detection runs before any record is committed for every entity type (skip-if-exists, or flag-for-transactions) per research.md §2-3. All ids are UUIDs; monetary fields stay integer. Soft-deleted (trashed) records are correctly excluded from export (research.md §4), so trash can never be silently resurrected by a re-import. | PASS |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/template-service.md, quickstart.md):

- `contracts/template-service.md` confirms `buildDataTemplate`, `exportDataTemplateToJsonBlob`,
  and `parseDataTemplate` are pure/read-only, and that `importDataTemplate` is the only impure
  function, calling exclusively through existing repositories and `TransactionEngine` —
  Principle III intact.
- `data-model.md` confirms the file format excludes `UserProfile`, `SessionKeyRow`, and
  `BackupRecord` by construction (they are simply never read into the template) — Principle II
  intact per research.md §1's reasoning, and FR-004 is structurally guaranteed rather than
  merely policy.
- `data-model.md`'s per-entity match-key table and `contracts/template-service.md`'s numbered
  import steps confirm every entity type is resolved against existing data (skip-if-exists) or
  explicitly flagged (transactions) before being written — Principle VI's non-destructive
  requirement is enforced in the data layer, not left to the UI.
- No new external dependency appears anywhere in data-model.md or the contract — Principle V
  intact.
- research.md §6's `deferBalance` + once-per-account-recalculation design confirms the
  performance constraint from Technical Context is met by construction, not left to chance.

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/015-setup-template-export-import/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── template-service.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── data/
│   └── io/
│       ├── templateService.ts        # NEW: buildDataTemplate(), exportDataTemplateToJsonBlob(),
│       │                                 parseDataTemplate(), importDataTemplate() — the
│       │                                 dependency-ordered create/skip/flag pass with id-remap
│       │                                 maps, per contracts/template-service.md
│       └── importService.ts          # MODIFIED: exports duplicateKey()/findDuplicateId()
│                                          (currently module-private) for reuse by
│                                          templateService.ts (research.md §3) — no behavior
│                                          change to the existing file-import path
│
└── pages/
    └── ExportPage.tsx                 # MODIFIED: adds a "Data Template" section — export
                                            button (downloads the JSON file) and an import
                                            control (file picker + result summary), alongside
                                            the existing CSV/XLSX export buttons, per
                                            research.md §8

tests/
├── unit/
│   └── templateService.test.ts        # NEW: parseDataTemplate validation/rejection,
│                                            per-entity match-key resolution, id-remap
│                                            correctness (including the Category/parent and
│                                            Attachment/resolved-duplicate special cases)
├── integration/
│   └── templateServiceImport.test.ts  # NEW: Dexie-backed create/skip/flag behavior across
│                                            every entity type, unresolved-relationship
│                                            handling, deferred-balance recalculation
└── e2e/
    └── dataTemplateExportImport.spec.ts # NEW: export → fresh-install import → re-import into
                                              a populated app, matching quickstart.md
```

**Structure Decision**: Extends the existing single frontend-only project layout unchanged
(see [../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)'s
Structure Decision, reused as-is by specs 002-010). This feature adds one new data-layer
module and extends two existing files (`importService.ts` for the small export-a-helper
change, `ExportPage.tsx` for the UI) — no new architectural layer, no new project, no new
Dexie schema version.

## Complexity Tracking

_Not applicable — Constitution Check identified no violations._
