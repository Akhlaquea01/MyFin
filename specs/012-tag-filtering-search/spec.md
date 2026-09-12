# Feature Specification: Tag-Based Filtering & Search for Transactions

**Feature Branch**: `012-tag-filtering-search`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Free-form tags (in addition to categories) with tag-based filtering/search across transactions, for cross-cutting labels like \"trip:japan\" or \"reimbursable\"."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Filter transactions by tag (Priority: P1)

A user has been tagging transactions (e.g., "trip:japan", "reimbursable") as they enter them, and now wants to see every transaction that carries a given tag, cutting across whatever categories and accounts those transactions happen to be in.

**Why this priority**: This is the entire point of tagging — cross-cutting labels are only useful once they can be used to slice the transaction list. Without this, tags are write-only.

**Independent Test**: Can be fully tested by tagging several transactions across different categories with the same tag, applying that tag as a filter on the transaction list, and verifying only those transactions appear.

**Acceptance Scenarios**:

1. **Given** transactions tagged with "reimbursable" exist alongside untagged transactions, **When** the user filters the transaction list by the "reimbursable" tag, **Then** only transactions carrying that tag are shown.
2. **Given** the user has applied a tag filter together with an existing filter (e.g., an account or date range), **When** the list is shown, **Then** results satisfy both filters at once.
3. **Given** a transaction carries multiple tags, **When** the user filters by any one of those tags, **Then** that transaction appears in the results.
4. **Given** the user selects more than one tag to filter by, **When** the list is shown, **Then** the system clearly indicates whether it is showing transactions matching any of the selected tags or all of them (see Assumptions for the chosen default).
5. **Given** the user clears the tag filter, **When** the list refreshes, **Then** it returns to showing transactions unrestricted by tag (subject to any other active filters).

---

### User Story 2 - Discover and pick existing tags while filtering (Priority: P2)

Rather than remembering and retyping exact tag spelling, the user wants to pick from tags that already exist on their transactions when setting up a filter.

**Why this priority**: Free-form tags are prone to spelling drift ("reimbursable" vs "Reimbursable"); a pick-list makes filtering reliable and fast, but User Story 1's filtering mechanism is usable without it (e.g., via a search box) at lower convenience.

**Independent Test**: Can be fully tested by creating a few distinctly-named tags via existing transaction entry, opening the tag filter control, and verifying every existing tag name appears as a selectable option with no need to type it from memory.

**Acceptance Scenarios**:

1. **Given** several tags already exist on the user's transactions, **When** the user opens the tag filter control, **Then** every existing tag is listed and selectable.
2. **Given** a long list of existing tags, **When** the user types a few characters into the filter control, **Then** the list narrows to tags matching what was typed.
3. **Given** no tags have ever been created, **When** the user opens the tag filter control, **Then** it clearly indicates there are no tags yet rather than showing an empty, unexplained list.

---

### User Story 3 - Search transactions by tag text (Priority: P3)

The user wants to type a tag (or part of one) directly into the existing free-text transaction search, without needing a separate, dedicated tag control, and have matching results surface.

**Why this priority**: A convenience that folds tag matching into an already-familiar search box; the dedicated filter from User Story 1 already covers the core need.

**Independent Test**: Can be fully tested by typing a tag's text into the existing transaction search box and verifying transactions carrying a matching tag are included in the results, even when the typed text does not appear in the transaction's notes or merchant name.

**Acceptance Scenarios**:

1. **Given** a transaction whose only match to a search term is one of its tags (not its notes or merchant), **When** the user searches using that term, **Then** the transaction is included in the results.
2. **Given** a search term that partially matches a tag (e.g., "japan" matching "trip:japan"), **When** the user searches using that term, **Then** the transaction is included in the results.

---

### Edge Cases

- What happens when a tag is applied to zero transactions (e.g., all previously tagged transactions were retagged or deleted)? It MUST no longer appear in the filter pick-list, since it no longer identifies any transaction.
- What happens when the user filters by a tag and then that tag's last transaction is deleted while the filtered view is open? The transaction MUST disappear from the (soft-deleted) list per existing deletion behavior, and the filter itself MUST not error.
- What happens when tag names differ only in letter case (e.g., "Trip:Japan" vs "trip:japan")? The system MUST treat them as the same tag for filtering purposes, consistent with how tags are already deduplicated at creation time.
- What happens when a user filters by a tag that no longer matches any transaction at the moment the filter is applied? The list MUST show an empty result with a clear "no matches" state, not an error.
- What happens when a very large number of distinct tags exist? The tag pick-list MUST remain usable via the narrowing/search behavior in User Story 2 rather than requiring the user to scroll through all of them.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST allow the user to filter the transaction list by one or more existing tags.
- **FR-002**: When multiple tags are selected for filtering, the system MUST combine them using "matches any of the selected tags" logic by default, and MUST make this behavior clear to the user.
- **FR-003**: A tag filter MUST compose with the transaction list's other existing filters (account, date range, free-text search) so that results satisfy all active filters simultaneously.
- **FR-004**: The system MUST present a pick-list of all tags currently applied to at least one non-deleted transaction, for use when setting up a tag filter.
- **FR-005**: The tag pick-list MUST narrow as the user types, matching against tag names.
- **FR-006**: The system MUST extend the transaction list's existing free-text search so that a search term matching part of a transaction's tag(s) includes that transaction in the results, in addition to whatever fields it already searches.
- **FR-007**: The system MUST treat tag names as case-insensitive for both filtering and search matching, consistent with existing tag deduplication behavior.
- **FR-008**: The system MUST allow the user to clear an active tag filter and return to the unfiltered (or otherwise-filtered) transaction list.
- **FR-009**: The system MUST exclude tags with zero currently-tagged, non-deleted transactions from the filter pick-list.

### Key Entities

- **Tag**: An existing free-form label a user can attach to any number of transactions (already creatable via transaction entry/review). This feature adds discovery (pick-list) and query (filter, search) capabilities on top of the existing tag data; it does not change how tags are created or assigned.
- **Transaction-Tag association**: The existing many-to-many link between a transaction and its tags, used as the basis for filtering and search matching.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can narrow the transaction list down to only transactions carrying a specific tag in 2 actions or fewer (open filter, pick tag).
- **SC-002**: 100% of transactions carrying a given tag appear when that tag is used as a filter, and 0% of transactions lacking it appear.
- **SC-003**: A user can find a specific existing tag in the filter pick-list by typing a few characters, without needing to recall its exact full spelling.
- **SC-004**: Searching by a term that matches only a transaction's tag (not its notes or merchant) surfaces that transaction, matching the existing search experience for other fields.

## Assumptions

- Tag creation and assignment to transactions already exist (via the New Transaction and Review screens); this feature is scoped to discovering, filtering, and searching by existing tags on the Transactions list, not to changing how tags are created.
- Selecting multiple tags to filter by defaults to "match any selected tag" (an OR combination), since cross-cutting labels like "trip:japan" and "reimbursable" are typically used to widen a view rather than narrow it further; "match all selected tags" (AND) is out of scope for this feature and may be considered later if requested.
- A dedicated tag management screen (renaming or deleting a tag outright, independent of any transaction) is out of scope for this feature; it only surfaces tags that already exist through normal transaction tagging.
- This feature does not change tag storage or the case-insensitive deduplication already applied when tags are created.
