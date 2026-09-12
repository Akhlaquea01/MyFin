# Contract: Tag Filter/Search Engine

Mirrors the pure-engine/thin-repository split this codebase already uses (e.g.
`reportEngine.ts`/`reportService.ts`, `financialHealthEngine.ts`/`financialHealthService.ts`):
the actual matching/narrowing/set logic is pure, unit-testable functions with no I/O; the
Dexie/decryption plumbing around them lives in the existing repositories
(`transactionRepository.ts`, `tagRepository.ts`), which call these functions rather than
reimplementing the logic inline.

## Pure functions — `src/domain/transactions/tagFilterEngine.ts` (NEW)

No `CryptoKey`, no repository import, no `async`, no Dexie types. Input/output only.

### `matchesAnyTag(transactionTagIds: string[], selectedTagIds: string[]): boolean`

- Returns `true` iff `transactionTagIds` and `selectedTagIds` share at least one id (OR
  semantics, FR-002).
- `selectedTagIds.length === 0` → returns `true` unconditionally (an empty filter selection
  excludes nothing — matches `TransactionFilter.tagIds` being absent/empty).
- Exposed primarily for unit testing the OR rule in isolation; `transactionRepository.search`'s
  actual production path uses the equivalent Dexie `anyOf` index query (research.md §2) for the
  same semantics, so this function is the executable spec those two must agree on.

### `normalizeTagText(value: string): string`

- `value.trim().toLowerCase()`. The single normalization used by every comparison below —
  factored out so pick-list narrowing and free-text tag matching can't silently drift apart
  (FR-007).

### `tagNameMatchesQuery(name: string, query: string): boolean`

- `normalizeTagText(name).includes(normalizeTagText(query))`.
- `query === ''` → returns `true` (an empty query narrows nothing — the full pick-list shows).

### `filterTagOptions(options: TagOption[], query: string): TagOption[]`

- `options.filter((o) => tagNameMatchesQuery(o.name, query))` (FR-005). Preserves the input
  order (callers pass already-sorted `TagOption[]`, per data-model.md).

### `distinctTagIdsInUse(transactionTagRows: { transactionId: string; tagId: string }[], liveTransactionIds: Set<string>): Set<string>`

- Returns the set of `tagId`s appearing in at least one row whose `transactionId` is in
  `liveTransactionIds` (FR-009, Edge Cases: a tag whose only transactions are soft-deleted is
  excluded).
- A `tagId` referenced by both a live and a deleted transaction is included (any live reference
  is enough).

### `transactionMatchesFreeText(notes: string | null, tagNames: string[], needle: string): boolean`

- `needle` is assumed already-normalized (caller passes `normalizeTagText(rawInput)` once, not
  per-transaction — matches the existing `search()` pattern of trimming/lowercasing `freeText`
  once at the top of the free-text step).
- Returns `true` if `normalizeTagText(notes ?? '').includes(needle)` **or** any
  `normalizeTagText(tagName).includes(needle)` (FR-006). Extends, never replaces, the existing
  notes-only check.

## Repository changes (impure) — `src/data/dexie/transactionRepository.ts`

### `TransactionFilter.tagIds?: string[]` (replaces `tagId?: string`)

`search()`'s existing tag block (currently lines 400-404) becomes:

1. `const tagRows = await db.transactionTags.where('tagId').anyOf(filter.tagIds).toArray()` when
   `filter.tagIds?.length`.
2. `idsWithAnyTag = new Set(tagRows.map((t) => t.transactionId))`; filter `transactions` down to
   that set — same shape as the existing `categoryId` block, just sourced from `anyOf` instead of
   `equals`.

### `search()`'s free-text step (currently lines 406-409), extended

When `filter.freeText` is set:

1. `needle = normalizeTagText(filter.freeText)`.
2. Batch-fetch `transactionTags` rows for exactly the current candidate transaction ids (the set
   already narrowed by every prior filter step), then resolve to tag names via
   `TagRepository.list(key)`'s `id → name` map (decrypted once, not per transaction).
3. Keep a transaction iff `transactionMatchesFreeText(tx.notes, tagNamesFor(tx.id), needle)`.

No other `search()` behavior changes — `accountId`/`categoryId`/date-range narrowing,
soft-delete exclusion, and result ordering (`sortNewestFirst`) are untouched.

## Repository additions (impure) — `src/data/dexie/tagRepository.ts`

### `TagRepository.listInUse(key: CryptoKey): Promise<TagOption[]>`

1. `transactionTagRows = await db.transactionTags.toArray()`.
2. `liveIds = new Set((await db.transactions.where('deletedAt').equals(NOT_DELETED).primaryKeys()) as string[])` —
   same index `countActive()` already uses.
3. `inUseIds = distinctTagIdsInUse(transactionTagRows, liveIds)`.
4. `tags = (await TagRepository.list(key)).filter((t) => inUseIds.has(t.id))`.
5. Return `tags` sorted by `normalizeTagText(name)` ascending, mapped to `{ id, name }`.

Returns `[]` (not an error) when no tag is currently in use (User Story 2, Acceptance Scenario 3
— "clearly indicates there are no tags yet", a UI-layer empty state over this empty array).

## What callers get for free by using this contract

- Story 1 (filter by tag): `TransactionsPage.tsx` passes `tagIds` (from the picker's selection)
  into the existing `TransactionRepository.search(key, filter)` call it already makes — no new
  call shape, just one more field alongside `accountId`/`dateFrom`/`dateTo`/`freeText`.
- Story 2 (pick-list): `TransactionsPage.tsx` calls `TagRepository.listInUse(key)` once per page
  load/refresh (same lifecycle as its existing `AccountRepository.list(key)` call) and narrows
  the rendered options locally via `filterTagOptions` as the user types — no per-keystroke Dexie
  query.
- Story 3 (search by tag text): no new UI at all — the existing free-text `Input` (`tx-filter-
  search`) now also matches tags because `search()`'s free-text step does, transparently.
