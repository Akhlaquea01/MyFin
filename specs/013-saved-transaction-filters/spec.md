# Feature Specification: Saved & Smart Transaction Filters

**Feature Branch**: `013-saved-transaction-filters`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Saved/smart filters on TransactionsPage.tsx — persist a filter combo (e.g., \"uncategorized this month\") as a one-click view."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Save the current filter combination as a named view (Priority: P1)

A user has set up a filter combination on the Transactions list they know they'll want again — for example, this month's date range plus a search for unreviewed items — and wants to save it under a name instead of re-entering every field next time.

**Why this priority**: This is the entire mechanism the feature depends on; nothing else is possible without a way to capture and name a filter combination.

**Independent Test**: Can be fully tested by setting several filter fields (e.g., account, date range, search text) to specific values, saving them under a name, and verifying a saved view record exists that captures exactly those values.

**Acceptance Scenarios**:

1. **Given** one or more filter fields are set on the Transactions list, **When** the user chooses to save the current filters and provides a name, **Then** a saved view is created capturing every currently-active filter field and that name.
2. **Given** no filter fields are set (an unfiltered "all transactions" state), **When** the user saves it under a name, **Then** a saved view is created representing "no filters applied."
3. **Given** the user tries to save a view without providing a name, **When** they attempt to save, **Then** the system requires a name before the save can complete.
4. **Given** a saved view already exists with the name the user enters, **When** they try to save a new view under that same name, **Then** the system asks whether to overwrite the existing view or choose a different name.

---

### User Story 2 - Apply a saved view with one action (Priority: P1)

Later, the user wants to jump straight back to that filtered view of their transactions without manually re-selecting every field.

**Why this priority**: This is the payoff of the feature — recalling a saved combination in one step is the entire reason to save it in the first place; it is equally critical to User Story 1.

**Independent Test**: Can be fully tested by saving a filter combination, changing the active filters to something else, then selecting the saved view and verifying every filter field and the resulting transaction list match exactly what was saved.

**Acceptance Scenarios**:

1. **Given** a saved view exists, **When** the user selects it from wherever saved views are listed, **Then** every filter field it captured is applied and the transaction list updates to match.
2. **Given** a saved view is currently applied, **When** the user manually changes any filter field, **Then** the list is no longer shown as matching that saved view (it reflects the current, edited filters instead).
3. **Given** several saved views exist, **When** the user views the list of saved views, **Then** each is identifiable by the name it was given.

---

### User Story 3 - Manage saved views (Priority: P2)

Over time the user's saved views become outdated or duplicated, and they want to rename or remove ones they no longer need without affecting the others.

**Why this priority**: Keeps the feature usable long-term, but the core save/apply loop (User Stories 1-2) already delivers value without this.

**Independent Test**: Can be fully tested by creating multiple saved views, renaming one, deleting another, and verifying only the targeted view was changed while the rest remain intact and applicable.

**Acceptance Scenarios**:

1. **Given** a saved view exists, **When** the user renames it, **Then** it continues to apply the same filters under its new name.
2. **Given** a saved view exists, **When** the user deletes it, **Then** it no longer appears among the saved views and can no longer be applied, while other saved views are unaffected.
3. **Given** the currently-applied filters match a saved view that the user then deletes, **When** the deletion completes, **Then** the currently-displayed transaction list is unaffected — only the saved view itself is removed.

---

### Edge Cases

- What happens when a saved view references a filter value that no longer exists (e.g., it filters by an account that was later deleted, or a tag that no longer applies to any transaction)? Applying the view MUST NOT error; it MUST apply the remaining valid filter fields and clearly indicate the missing one was dropped.
- What happens when the user saves a view, then the set of filter controls available on the Transactions list changes in a future update (e.g., a new filter field is added)? Existing saved views MUST continue to apply the filter fields they captured, without requiring the user to redefine them.
- What happens when two saved views end up with identical filter combinations under different names? Both MUST remain independently applicable and manageable; the system does not need to detect or merge duplicates.
- What happens when the user has a very large number of saved views? The list of saved views MUST remain easy to scan and select from (e.g., ordered by name or recency) rather than becoming unusable.
- What happens when the user renames a saved view to a name that collides with another existing saved view? The system MUST prevent the rename (or require confirming an overwrite), consistent with the save-time duplicate-name handling.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST let the user save the Transactions list's currently-active filter combination — whatever filter fields the list currently supports (e.g., account, date range, search text, and any others available at the time) — under a user-provided name.
- **FR-002**: The system MUST require a non-empty name to save a view, and MUST handle an attempt to reuse an existing name by asking the user to overwrite or rename rather than silently creating a duplicate or silently failing.
- **FR-003**: The system MUST present the user's saved views in a list from which any one can be applied in a single action.
- **FR-004**: Applying a saved view MUST set every filter field it captured to the saved values and MUST refresh the transaction list to match.
- **FR-005**: The system MUST let the user rename an existing saved view without changing the filters it applies.
- **FR-006**: The system MUST let the user delete an existing saved view, which MUST NOT affect any other saved view or the currently-displayed transaction list.
- **FR-007**: Saved views MUST persist across app sessions (available the next time the user opens the app), consistent with the app's local, on-device data storage.
- **FR-008**: Applying a saved view that references a filter value no longer valid (e.g., a deleted account) MUST NOT produce an error; the system MUST apply the remaining valid filter fields and inform the user that one field could not be restored.
- **FR-009**: Editing any filter field after a saved view has been applied MUST NOT alter the saved view itself — the saved view only changes when the user explicitly re-saves or renames it.

### Key Entities

- **Saved Filter View**: A user-named snapshot of the Transactions list's filter fields at the moment it was saved (e.g., account, date range, search text, or any other filter field the list supports). Applying it reproduces that exact filtered view of transactions. Independent of any specific transaction — it stores filter criteria, not transaction references.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can save the current filter combination under a name in 2 actions or fewer once the filters are already set.
- **SC-002**: A user can return to a previously saved filtered view in a single action from anywhere on the Transactions list.
- **SC-003**: 100% of saved views reproduce an identical transaction list to manually re-entering the same filter values, for as long as the underlying filter values remain valid.
- **SC-004**: A user can rename or delete any one saved view without any observable change to the other saved views.

## Assumptions

- This feature covers user-created saved views only; the app does not ship any pre-built/system-provided example views (such as an out-of-the-box "uncategorized this month" preset) — the example in the feature description illustrates the kind of combination a user would save themselves, not a required built-in.
- Saved views capture whichever filter fields the Transactions list currently exposes at save time; this feature does not require every possible filter field to exist first, only that the mechanism can save and restore whatever fields are present (today: account, date range, and free-text search).
- Saved views are local to the device/browser profile, consistent with the app's local-first, zero-server storage model — there is no cross-device sync of saved views.
- There is no limit on the number of saved views a user may create beyond what keeps the saved-views list practically scannable, per the corresponding Edge Case.
