# Quickstart: Tag-Based Filtering & Search for Transactions

## Prerequisites

- Dev server running: `npm run dev`
- An onboarded profile (PIN set) with at least one account
- Vitest available for the automated scenarios below (`npm run test`)

## Scenario 1 — Filter by a single tag (Story 1, SC-001, SC-002)

1. Record three transactions across at least two different categories; tag two of them
   "reimbursable" (via the New Transaction or Review screen's existing tag input), leave the
   third untagged.
2. Navigate to **Transactions**, open the tag filter control, select "reimbursable".
3. **Expected**: exactly the two tagged transactions appear (SC-002); the untagged one does not.
   Reaching this view took opening the filter and picking the tag — 2 actions (SC-001).

## Scenario 2 — Tag filter composes with other filters (Acceptance Scenario 2)

1. From Scenario 1, also set an account filter or a date range that only one of the two
   "reimbursable" transactions falls within.
2. **Expected**: only the transaction satisfying both the tag filter and the other active filter
   is shown.

## Scenario 3 — Multiple tags, OR semantics (Acceptance Scenarios 3-4, FR-002)

1. Tag one transaction "trip:japan" only, another "reimbursable" only, and a third with both.
2. Select both "trip:japan" and "reimbursable" in the tag filter.
3. **Expected**: all three transactions appear (any-of-selected-tags match); the control's own
   copy makes clear this is an "any of" match, not "all of" (FR-002).

## Scenario 4 — Clear the tag filter (Acceptance Scenario 5, FR-008)

1. From any active tag filter, clear it.
2. **Expected**: the list returns to showing transactions unrestricted by tag, still respecting
   any other active filters (account/date/search).

## Scenario 5 — Tag pick-list discovery and narrowing (Story 2, SC-003)

1. Ensure at least five distinctly-named tags exist across your transactions (e.g.
   "reimbursable", "trip:japan", "trip:goa", "subscriptions", "gifts").
2. Open the tag filter control with no text typed. **Expected**: every existing tag is listed and
   selectable (Acceptance Scenario 1).
3. Type "trip". **Expected**: the list narrows to "trip:japan" and "trip:goa" only (Acceptance
   Scenario 2, SC-003) — no need to recall either tag's full spelling.

## Scenario 6 — No tags yet (Acceptance Scenario 3, Story 2)

1. On a freshly onboarded profile with zero tagged transactions, open the tag filter control.
2. **Expected**: a clear "no tags yet" message, not an empty, unexplained list.

## Scenario 7 — A tag drops to zero transactions (Edge Cases)

1. Tag a transaction "conference", confirm it appears in the pick-list.
2. Delete that transaction (or remove the tag from it, leaving no other transaction carrying
   "conference").
3. Reopen the tag filter control. **Expected**: "conference" no longer appears in the pick-list
   (FR-009) — it no longer identifies any live transaction.

## Scenario 8 — Search by tag text via the existing search box (Story 3, SC-004)

1. Tag a transaction "trip:japan" whose notes/merchant contain neither "trip" nor "japan".
2. Type "japan" into the existing transaction free-text search (not the tag filter control).
3. **Expected**: that transaction is included in the results (Acceptance Scenarios 1-2, SC-004),
   exactly as if "japan" had matched its notes.

## Scenario 9 — Case-insensitive matching (Edge Cases, FR-007)

1. With a tag stored as "Trip:Japan" (original case as entered), filter using the pick-list entry
   (rendered in its stored case) and separately search free-text using "trip:japan" (lowercase).
2. **Expected**: both the filter and the free-text search match the same transactions regardless
   of case.

## Automated coverage (see tasks.md for the actual task breakdown)

- `tests/unit/tagFilterEngine.test.ts` — every pure function in
  [contracts/tag-filter-engine.md](contracts/tag-filter-engine.md): OR matching (including the
  empty-selection case), case-insensitive narrowing and free-text tag matching, and
  `distinctTagIdsInUse`'s edge cases (tag referenced only by a deleted transaction; tag referenced
  by both a live and a deleted transaction; no tags at all).
- `tests/integration/ledgerRepositories.test.ts` (extended) — `TransactionRepository.search`'s
  `tagIds` OR-composition with `accountId`/date-range/`categoryId`, and the free-text step
  matching against tag names in addition to `notes`; `TagRepository.listInUse` against a real
  Dexie instance (`fake-indexeddb`), covering the zero-tags and tag-dropped-to-zero-transactions
  cases from Scenario 7.
- `tests/e2e/tagFilteringSearch.spec.ts` — Scenarios 1, 3, 5, 6, and 8 end-to-end, using the same
  fixture-building patterns as `tests/e2e/ledger.spec.ts`.
