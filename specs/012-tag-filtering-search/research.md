# Phase 0 Research: Tag-Based Filtering & Search for Transactions

Everything below was resolvable directly from the existing codebase and constitution — no
external library research was needed; this feature adds query capability over data structures
that already exist.

## 1. Tag storage today (baseline, unchanged by this feature)

`Tag` (`src/domain/entities.ts:49`) is `{ id, name, createdAt, updatedAt }` — `name` is the
original-case, trimmed text; case-insensitive dedup already happens at creation time via a
**blind-index hash**, not by lowercasing the stored name: `TagRepository.getOrCreate`
(`src/data/dexie/tagRepository.ts:8-20`) hashes `trimmed.toLowerCase()`-equivalent digest
(`blindIndex`) and looks it up against `db.tags`'s indexed `nameHash` column (schema v8,
`db.ts:278-281`) before creating a new row. The `Tag.name` column itself is encrypted at rest
(`putEncrypted`), so there is no plaintext, indexed tag-name column to run a `LIKE`/prefix query
against directly — every tag-name comparison (narrowing the pick-list, matching free-text
search) necessarily happens **after** decrypting the (typically small) full tag set via
`TagRepository.list(key)`, in memory.

`TransactionTag` (`entities.ts:83-86`, `{transactionId, tagId}`) is a pure many-to-many join row,
stored unencrypted (`transactionTags` table, schema v1, `db.ts:228`) with indexes on both
`transactionId` and `tagId`. No per-tag transaction-count cache exists.

**Decision**: Build on these as-is — no schema change, no new table (Constitution Principle VI
concerns itself with soft-delete/integrity of *new* mutable state; this feature introduces none).

## 2. Multi-tag OR filtering (FR-001, FR-002, FR-003)

**Decision**: Replace `TransactionFilter.tagId?: string` (`transactionRepository.ts:44`,
currently implemented at lines 400-404 but **not called by any UI today** — grep confirms
`TransactionsPage.tsx` never passes it) with `tagIds?: string[]`. Implementation:
`db.transactionTags.where('tagId').anyOf(tagIds).toArray()` → the set of `transactionId`s
carrying *any* of the selected tags is exactly Dexie's `anyOf` union over the existing `tagId`
index — OR semantics fall out of the index query itself, no post-filtering logic to get wrong.
This composes with the existing `accountId`/date-range/`categoryId` narrowing exactly like the
current single-`tagId` code already does (same `Set`-intersection-via-`.filter()` pattern used
for `categoryId` at lines 391-398).

**Rationale**: `anyOf` is the direct, already-indexed expression of "matches any of the selected
tags" — no new index, no in-memory de-duplication logic to unit test beyond confirming the
composition with other filters works (which the existing integration test style already covers
for `categoryId`).

**Alternatives considered**: Running one `.equals(tagId)` query per selected tag and unioning
results in JS. Rejected — `anyOf` is Dexie's built-in, already-optimized equivalent; reimplementing
it manually would be pure duplication.

## 3. Free-text search extended to tag names (FR-006)

**Decision**: `TransactionRepository.search`'s existing free-text step (`notes` substring match,
lines 406-409) runs **after** decryption, over the already-narrowed candidate set. Extend it to
also check each candidate transaction's tag names: batch-fetch `transactionTags` rows for exactly
the candidate transaction ids (`db.transactionTags.where('transactionId').anyOf(candidateIds)`),
decrypt the full tag set once via `TagRepository.list(key)` into an `id → name` map, then for each
candidate transaction check `notes` OR any of its resolved tag names against the search term —
the actual per-transaction comparison is the new pure `transactionMatchesFreeText` (contracts/
tag-filter-engine.md), so the matching *rule* is unit-tested independent of the Dexie plumbing
around it.

**Rationale**: The candidate set is already narrowed by every other active filter before this
step runs (mirroring the existing comment at `transactionRepository.ts:365-368` about decryption
being the dominant cost) — the additional `transactionTags`/tag-name lookup only touches
transactions that already passed every structural filter, not the whole ledger.

**Alternatives considered**: Decrypting/joining tags eagerly for every transaction in `search()`
regardless of whether `freeText` was supplied. Rejected — pure overhead on the (common) case
where no free-text search is active; the lookup is now conditional on `filter.freeText` being set,
same discipline the existing `categoryId`/`tagIds` blocks already follow.

## 4. Case-insensitivity (FR-007)

**Decision**: All three comparison points — pick-list narrowing (Story 2), tag-filter matching
(already exact-`id`-based so case doesn't apply there), and free-text tag-name matching (Story 3)
— lowercase both sides at comparison time (`value.trim().toLowerCase()`), the same normalization
`search()` already applies to `freeText` against `notes` (line 407). This does **not** change how
tags are deduplicated at creation (still the existing blind-index hash) — it only makes *querying*
against the already-deduplicated `Tag.name` case-insensitive, consistent with FR-007's own wording
("consistent with existing tag deduplication behavior").

**Rationale**: Reuses the exact `.toLowerCase()` idiom already established in this file; no new
normalization scheme to invent or keep in sync with the creation-time dedup logic.

## 5. Pick-list scoped to non-deleted transactions (FR-004, FR-009, Edge Cases)

**Decision**: New `TagRepository.listInUse(key)`: fetch all `transactionTags` rows, fetch all
non-deleted transaction ids (`db.transactions.where('deletedAt').equals(NOT_DELETED)` — the same
index `countActive()` already uses at `transactionRepository.ts:415-417`), compute the set of
`tagId`s referenced by at least one live transaction via a new pure helper
`distinctTagIdsInUse(transactionTagRows, liveTransactionIds)`, then decrypt only `TagRepository
.list(key)`'s rows whose `id` is in that set, sorted case-insensitively by name.

**Rationale**: Keeping the set-computation as a pure, unit-testable function (rather than inline
in the repository) follows this codebase's established "pure engine function + thin
repository/service wrapper" convention (e.g. `reportEngine.ts`/`reportService.ts`,
`financialHealthEngine.ts`/`financialHealthService.ts`) and is exactly the kind of logic whose
edge cases (a tag referenced only by a since-deleted transaction; a tag referenced by both a live
and a deleted transaction) are easy to get subtly wrong without a direct unit test.

**Alternatives considered**: Maintaining a live denormalized `tagUsageCount` column, updated on
every tag assignment/deletion. Rejected — unrequested scope (out-of-scope per spec Assumptions:
no tag-management screen), and the ledger sizes this app targets (SC-002/SC-003 imply pick-list
usability, not systems-scale tag volumes) make an on-demand join cheap enough not to need caching.

## 6. Pick-list / multi-select UI pattern (Story 2)

**Decision**: No combobox/command-palette component exists in `src/components/ui/` today (only
`alert, avatar, badge, button, card, dialog, dropdown-menu, input, label, select, separator, sheet,
skeleton, sonner, switch, table, tabs, textarea, tooltip, progress`). Build a small, purpose-built
tag-filter control: a `Popover` (new shadcn-style primitive wrapping Radix's `Popover.Root` —
`radix-ui` unified package `^1.6.7` is already a dependency, so this is a zero-new-dependency
addition, same as how `dropdown-menu.tsx` already wraps the same package's menu primitive) whose
content is a text `Input` (narrows via `filterTagOptions`, contracts/tag-filter-engine.md) plus a
plain scrollable list of toggleable rows, with selected tags shown as removable `Badge`s in the
filter bar — reusing existing `Input`/`Badge`/`Button` primitives, no new list/virtualization
library.

**Rationale**: `cmdk` (the library shadcn's own `Command` component wraps) is not a current
dependency and this feature's actual requirements — type-to-narrow, multi-select, an explicit
empty state (FR "no tags yet" / Edge Case "very large number of tags... via the narrowing... rather
than scrolling") — don't need `cmdk`'s virtualization or command-palette keyboard model. This
matches the project's established pattern of hand-rolling exactly the interaction needed instead
of pulling in a heavier library (e.g. `TransactionsPage.tsx`'s own row-level virtualization instead
of `react-window`/`react-virtual`), and keeps Constitution Principle V's "every dependency
justified" bar easy to clear (zero new dependencies).

**Alternatives considered**: Adding `cmdk` + shadcn's full `Command`/`Popover` combo (the
"standard" shadcn combobox recipe). Rejected for this feature's scope — no keyboard-driven command
palette is needed, just a filterable multi-select list; adding a new runtime dependency for that
is unjustified scope.

## 7. Schema/version impact

**Decision**: None. No new Dexie table, no new indexed column, no version bump — `tags` (v8:
`id, nameHash`) and `transactionTags` (v1: `id, transactionId, tagId`) already carry every index
this feature's queries need (`tagId` for the filter, `transactionId` for the free-text tag lookup
and for the in-use computation, `deletedAt` on `transactions` for both).
