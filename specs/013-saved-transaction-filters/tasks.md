# Tasks: 013-saved-transaction-filters

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

*(No setup tasks required. Feature is added to an existing project.)*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T001 Define `SavedFilterView` interface in `src/domain/entities.ts`
- [x] T002 Implement `SavedFilterViewRepository` (including `db.ts` table `savedFilterViews` update) in `src/data/dexie/savedFilterViewRepository.ts` and `src/data/dexie/db.ts`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Save the current filter combination as a named view (Priority: P1) 🚀 MVP

**Goal**: Save the current filter combination on the Transactions list under a name instead of re-entering every field next time.

**Independent Test**: Set several filter fields, save them under a name, and verify a saved view record exists capturing exactly those values.

### Implementation for User Story 1

- [x] T003 [US1] Create Save View button and Dialog UI component in `src/pages/TransactionsPage.tsx`
- [x] T004 [US1] Wire the Save View submit action to `SavedFilterViewRepository.create` (handling duplicate name check) inside `src/pages/TransactionsPage.tsx`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - Apply a saved view with one action (Priority: P1)

**Goal**: Recall a saved combination in one step to jump straight back to a filtered view.

**Independent Test**: Save a filter combination, change the active filters, then select the saved view and verify every filter field and transaction list updates to match.

### Implementation for User Story 2

- [x] T005 [US2] Add dropdown/list UI for selecting available saved views in `src/pages/TransactionsPage.tsx`
- [x] T006 [US2] Implement logic to apply a selected `SavedFilterView` to current filter states (with missing references warning) in `src/pages/TransactionsPage.tsx`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - Manage saved views (Priority: P2)

**Goal**: Rename or remove ones they no longer need without affecting others.

**Independent Test**: Rename one view, delete another, and verify only the targeted view changed while others remained intact.

### Implementation for User Story 3

- [x] T007 [P] [US3] Implement rename saved view functionality (UI and repository update) in `src/pages/TransactionsPage.tsx`
- [x] T008 [P] [US3] Implement delete saved view functionality (UI and repository delete) in `src/pages/TransactionsPage.tsx`

**Checkpoint**: All user stories should now be independently functional

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T009 Run quickstart.md validation to ensure end-to-end functionality

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: N/A
- **Foundational (Phase 2)**: BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User Story 1 (P1) -> User Story 2 (P1) -> User Story 3 (P2)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### Parallel Opportunities

- T007 and T008 can be executed in parallel since renaming and deleting are separate independent UI interactions on a list item.
