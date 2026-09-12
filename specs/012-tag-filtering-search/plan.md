# Implementation Plan: Tag-Based Filtering & Search for Transactions

**Branch**: `012-tag-filtering-search` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/012-tag-filtering-search/spec.md`

## Summary

Users can already attach free-form tags to transactions (New Transaction / Review screens); this
feature adds the query side on top of that existing data: a multi-select tag filter (OR
semantics) on the Transactions list that composes with the existing account/date/free-text
filters, a type-to-narrow pick-list of every tag currently in use by a non-deleted transaction,
and an extension of the existing free-text search so a search term also matches tag names.
Technical approach: a new pure `tagFilterEngine.ts` (OR matching, case-insensitive narrowing and
free-text tag matching, live-tag-set computation — no I/O) plus small, additive extensions to the
two existing repositories that already own this data: `TransactionRepository.search()` gains
`tagIds?: string[]` (replacing an unused, singular `tagId`) implemented via Dexie's `anyOf` index
query, and its free-text step is extended to also check each candidate transaction's tag names;
`TagRepository` gains `listInUse(key)`, decrypting and filtering the existing tag set down to
"referenced by at least one live transaction". No new Dexie table, no schema version bump. The UI
adds one new small, dependency-free multi-select popover component to `TransactionsPage.tsx`
(built from the already-present `radix-ui` package, no new runtime dependency) alongside the
existing filter controls.

## Technical Context

**Language/Version**: TypeScript 5.x, same evergreen-browser target as the core app (Vite)

**Primary Dependencies**: React 19 + React Router, shadcn/ui on Tailwind CSS, Dexie.js, and
Vitest are all reused unchanged — see
[../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md). **New**: one
new shadcn-style UI primitive, `src/components/ui/popover.tsx`, wrapping the `radix-ui` package's
`Popover` — this package is already a dependency (`^1.6.7`, used today by `dropdown-menu.tsx`), so
this adds **zero new runtime dependencies** (research.md §6).

**Storage**: IndexedDB via Dexie.js — no new table, no schema version bump. This feature only
adds query logic over the existing `tags` and `transactionTags` tables (research.md §1, §7),
both of which already carry every index (`nameHash`, `tagId`, `transactionId`) these queries need.

**Testing**: Vitest unit tests for every pure function in `tagFilterEngine.ts` (contracts/
tag-filter-engine.md) — OR matching, case-insensitive narrowing/free-text matching,
`distinctTagIdsInUse` edge cases. Vitest/integration tests extending `ledgerRepositories.test.ts`
for `TransactionRepository.search`'s `tagIds` composition with existing filters and the extended
free-text step, plus new tests for `TagRepository.listInUse` against a real Dexie instance
(`fake-indexeddb`). A Playwright E2E test covering pick-list discovery/narrowing, tag filtering
(single and multi-tag OR), filter clearing, and tag-text free search (quickstart.md).

**Target Platform**: Same installable PWA (Android/iOS/desktop); no platform-specific behavior,
no new route — this extends the existing Transactions page in place.

**Project Type**: Web — single frontend-only project (no backend exists or is planned)

**Performance Goals**: The tag filter itself is one indexed `anyOf` query, no heavier than the
existing `categoryId` filter it sits beside. The free-text-over-tags extension only decrypts/
resolves tag names for the candidate set already narrowed by every other active filter (research.md
§3) — not the whole ledger — keeping the existing "decrypt only what survives structural
filtering" discipline (`transactionRepository.ts:365-368`) intact. `TagRepository.listInUse`
decrypts the full tag set once per page load, the same cost class as the existing
`TagRepository.list` calls made today from the tag-entry UI.

**Constraints**: Tag-name comparisons (pick-list narrowing, free-text tag matching) MUST be
case-insensitive (FR-007) without changing how tags are deduplicated at creation (the existing
blind-index hash is untouched). The tag pick-list MUST exclude tags with zero live (non-deleted)
transaction associations (FR-009) and MUST present a clear empty state when no tags exist at all
(Acceptance Scenario 3) — not an unexplained empty list.

**Scale/Scope**: One new domain module (`tagFilterEngine.ts`, pure), two extended existing
repositories (no new repository), one new dependency-free UI primitive, one extended existing page
(no new page/route); 3 prioritized user stories, 9 functional requirements (see [spec.md](spec.md)).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                    | Check                                                                                                                                                                                                                                                       | Status |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| I. Local-First & Zero-Server                   | Every query (tag filter, pick-list, tag-aware search) runs entirely against already-local IndexedDB data via existing repositories; no network call, no new backend surface.                                                                              | PASS   |
| II. Privacy & Encryption by Default            | No new storage, no new encrypted column — `tags`/`transactionTags` are read exactly as `TagRepository`/`TransactionRepository` already read them today (decrypted `Tag` rows in memory, never logged). Tag-name comparisons happen only on already-decrypted plaintext in memory, same trust boundary as the existing free-text search over `notes`. | PASS   |
| III. Layered Clean Architecture                | `tagFilterEngine.ts` is pure (no repository import, no `async`, plain data in/out); `TransactionRepository.search`/`TagRepository.listInUse` are the only impure callers, both already the correct Data-layer home for this logic; `TransactionsPage.tsx` calls only these repository functions, never `db` directly. | PASS   |
| IV. Test-First for Financial Logic             | Not one of the four named engines, and not itself a money-affecting calculation — but per the precedent applied to specs 002-004, 006, 007, 011, a query engine whose correctness the user directly relies on to trust "did I see every matching transaction" (SC-002: 100%/0% precision) gets the same bar: every pure function in the contract MUST have unit tests passing before done, plus integration tests for the two repository extensions. | PASS (process gate, enforced in tasks phase) |
| V. Free & Open-Source Only                     | Zero new dependencies — the one new UI primitive wraps the already-present, already-used `radix-ui` package (research.md §6); no paid API, no new infra.                                                                                                    | PASS   |
| VI. Data Integrity & Non-Destructive Operations | No new mutable state, no new soft-delete surface — this feature only reads `Transaction.deletedAt` (via the existing `NOT_DELETED` convention) to decide pick-list membership; it never writes to `Tag`/`TransactionTag`/`Transaction`.                    | PASS   |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/tag-filter-engine.md, quickstart.md):

- `contracts/tag-filter-engine.md` confirms every function in `tagFilterEngine.ts` is synchronous
  and pure (no `CryptoKey` parameter, no repository import, no Dexie type) — Principle III intact.
- `data-model.md`'s relationship diagram confirms no arrow writes to `Tag`, `TransactionTag`, or
  `Transaction` — every addition is a read-only selector or predicate — Principle II and VI intact
  (nothing new to encrypt, nothing new to soft-delete).
- research.md §1 and §7 confirm no schema change: both tables this feature queries already carry
  every index needed (`nameHash`, `tagId`, `transactionId`, `deletedAt`) — no version bump.
- research.md §6 confirms the one new UI primitive (`popover.tsx`) adds zero new dependencies,
  wrapping the already-present `radix-ui` package the same way `dropdown-menu.tsx` already does —
  Principle V intact.

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/012-tag-filtering-search/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── tag-filter-engine.md
├── checklists/
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── domain/
│   └── transactions/
│       ├── transactionEngine.ts              # UNCHANGED
│       └── tagFilterEngine.ts                # NEW: pure functions — matchesAnyTag(),
│                                                normalizeTagText(), tagNameMatchesQuery(),
│                                                filterTagOptions(), distinctTagIdsInUse(),
│                                                transactionMatchesFreeText()
│
├── data/
│   └── dexie/
│       ├── tagRepository.ts                  # EXTENDED: + TagRepository.listInUse(key)
│       └── transactionRepository.ts          # EXTENDED: TransactionFilter.tagIds?: string[]
│                                                (replaces unused tagId?: string); search()'s
│                                                tag block uses anyOf(); free-text step also
│                                                matches tag names
│
├── components/
│   └── ui/
│       └── popover.tsx                       # NEW: shadcn-style wrapper over radix-ui's
│                                                Popover primitive (no new dependency)
│
└── pages/
    └── TransactionsPage.tsx                  # EXTENDED: new tag-filter control (Popover +
                                                 Input narrowing + toggleable list + selected-tag
                                                 Badges) alongside the existing account/date/
                                                 search filter row; passes tagIds into the
                                                 existing TransactionRepository.search() call

tests/
├── unit/
│   └── tagFilterEngine.test.ts               # NEW
├── integration/
│   └── ledgerRepositories.test.ts            # EXTENDED: tagIds composition, tag-aware free
│                                                text, TagRepository.listInUse
└── e2e/
    └── tagFilteringSearch.spec.ts            # NEW
```

**Structure Decision**: Extends the existing single frontend-only project layout unchanged (see
[../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)'s Structure
Decision, reused as-is by specs 002-011). This feature adds one new pure-engine module under the
existing `domain/transactions/` directory (alongside `transactionEngine.ts`, not a new top-level
domain area — this is transaction *query* logic, not a distinct bounded concept), one new
dependency-free `components/ui/` primitive, and extends two existing repositories/one existing
page in place — no new architectural layer, no new project, no schema change, no new route.

## Complexity Tracking

_No violations identified — this section is not needed for this plan._
