# Implementation Tasks: Complete Data Template Export & Import

**Feature**: Complete Data Template Export & Import  
**Branch**: `015-setup-template-export-import` | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project preparation and shared utilities needed across multiple modules.

- [x] T001 Export duplicate transaction detection utilities (`duplicateKey`, `shiftIsoDay`, `findDuplicateId`) from `src/data/io/importService.ts`
- [x] T002 [P] Define `DataTemplate`, `TemplateImportResult`, and entity match key types in `src/data/io/templateTypes.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core template container parsing, validation, and rejection logic required by all import/export flows.

> **CRITICAL**: Foundational tasks must be complete before User Story implementation begins.

- [x] T003 Create template serialization and validation module skeleton with `parseDataTemplate` in `src/data/io/templateService.ts`
- [x] T004 [P] Implement unit tests for `parseDataTemplate` structural validation and rejection cases in `tests/unit/templateService.test.ts`

**Checkpoint**: Foundation ready — template parsing and shared types verified.

---

## Phase 3: User Story 1 - Export everything as one template file (Priority: P1) 🎯 MVP

**Goal**: Enable the user to export all of their data across accounts, categories, budgets, transactions, investments, liabilities, tags, rules, and attachments into a single, unencrypted, human-readable JSON template file without security credentials.

**Independent Test**: Populate sample records across multiple entity types, trigger template export, and inspect the resulting JSON file to verify all entities and cross-references are captured while security credentials (PIN verifier, salts, biometric data) are omitted.

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T005 [P] [US1] Write unit tests for `buildDataTemplate` and `exportDataTemplateToJsonBlob` (empty state, multi-entity export, credential exclusion) in `tests/unit/templateServiceExport.test.ts`

### Implementation for User Story 1

- [x] T006 [US1] Implement `buildDataTemplate` in `src/data/io/templateService.ts` to read active records across all repositories via `list()`
- [x] T007 [US1] Implement `exportDataTemplateToJsonBlob` in `src/data/io/templateService.ts` to serialize template as a JSON `Blob`
- [x] T008 [US1] Add "Data Template Export" card and download action with status toasts in `src/pages/ExportPage.tsx`

**Checkpoint**: At this point, User Story 1 (MVP) is fully functional and testable independently.

---

## Phase 4: User Story 2 - Import a template to recreate everything (Priority: P1)

**Goal**: Enable a user on a fresh install or empty database to import a template file, recreating every entity in dependency order with foreign keys and parent categories remapped, while providing an import result summary.

**Independent Test**: Start with an empty database, import a valid multi-entity template file, and verify all records (accounts, categories, transactions, budgets, investments, attachments) are recreated with proper links and updated account balances.

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T009 [P] [US2] Write integration tests for fresh-install import, entity remapping, and unresolved relationship handling in `tests/integration/templateServiceImport.test.ts`

### Implementation for User Story 2

- [x] T010 [US2] Implement dependency-ordered entity creation and ID remapping in `importDataTemplate` in `src/data/io/templateService.ts`
- [x] T011 [US2] Implement transaction creation with `deferBalance: true`, category splits, tags, attachments, and single-pass balance recalculation in `src/data/io/templateService.ts`
- [x] T012 [US2] Implement graceful handling and skipped reporting for unresolvable relationships in `src/data/io/templateService.ts`
- [x] T013 [US2] Add "Import Data Template" file input, progress indicator, and import summary dialog in `src/pages/ExportPage.tsx`

**Checkpoint**: User Stories 1 and 2 are both functional — full export/import cycle works on clean installs.

---

## Phase 5: User Story 3 - Import into an app that already has data (Priority: P2)

**Goal**: Support additive, non-destructive import into a populated database by skipping existing structural records, flagging matching transactions for user review, and preventing attachment misattribution.

**Independent Test**: Import a template containing records that overlap with existing data; verify existing records are untouched, zero duplicate categories/accounts are created, matching transactions are flagged as unreviewed duplicates, and result summary distinguishes created vs skipped vs flagged records.

### Tests for User Story 3

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T014 [P] [US3] Write integration tests for overlapping import (skip-if-exists, duplicate transaction flagging, attachment skipping on pre-existing transactions) in `tests/integration/templateServiceOverlapping.test.ts`

### Implementation for User Story 3

- [x] T015 [US3] Implement per-entity duplicate matching (skip-if-exists) for accounts, categories, merchants, tags, budgets, investments, liabilities, and preferences in `src/data/io/templateService.ts`
- [x] T016 [US3] Implement transaction duplicate detection reusing `findDuplicateId` with `duplicateOfId` and `reviewStatus: 'unreviewed'` in `src/data/io/templateService.ts`
- [x] T017 [US3] Implement attachment skipping when parent transaction resolves to a pre-existing transaction in `src/data/io/templateService.ts`
- [x] T018 [US3] Implement `MerchantCategorySignal` rolling-window merge logic in `src/data/io/templateService.ts`
- [x] T019 [US3] Update import results summary UI in `src/pages/ExportPage.tsx` to render granular breakdown of created, skipped, and flagged items with reasons

**Checkpoint**: All three user stories are complete and independently verifiable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Performance verification, large-dataset handling, and end-to-end validation.

- [x] T020 [P] Implement end-to-end Playwright test covering export, fresh-install import, and overlapping re-import in `tests/e2e/dataTemplateExportImport.spec.ts`
- [x] T021 [P] Add event-loop yielding (`PROGRESS_INTERVAL`) during bulk transaction import in `src/data/io/templateService.ts`
- [x] T022 Run quickstart validation scenarios and verify all tests pass via `npm test`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion.
- **User Story 2 (Phase 4)**: Depends on Foundational completion and reuses types/parser. Can run after or in parallel with US1.
- **User Story 3 (Phase 5)**: Depends on User Story 2's core import loop.
- **Polish (Phase 6)**: Depends on completion of all user stories.

### User Story Dependencies

```mermaid
flowchart TD
    Setup[Phase 1: Setup] --> Foundational[Phase 2: Foundational]
    Foundational --> US1[Phase 3: US1 - Export Everything (MVP)]
    Foundational --> US2[Phase 4: US2 - Fresh Install Import]
    US2 --> US3[Phase 5: US3 - Overlapping & Duplicate Import]
    US1 --> Polish[Phase 6: Polish & Cross-Cutting]
    US3 --> Polish
```

---

## Parallel Opportunities

- **Phase 1**: `T001` and `T002` can be executed in parallel.
- **Phase 2**: `T004` (unit tests) can be written in parallel with `T003` skeleton.
- **Phase 3**: `T005` (unit tests) can run in parallel before implementation of `T006` and `T007`.
- **Phase 4**: `T009` (integration tests) can be drafted in parallel with `T010`.
- **Phase 5**: `T014` (overlapping integration tests) can be drafted in parallel with `T015`.
- **Phase 6**: `T020` (E2E test) and `T021` (event-loop yielding) can be done in parallel.

---

## Parallel Example: User Story 1

```bash
# Launch test and UI preparation in parallel:
Task: "Write unit tests for buildDataTemplate and exportDataTemplateToJsonBlob in tests/unit/templateServiceExport.test.ts"
Task: "Add Data Template Export card and download action with status toasts in src/pages/ExportPage.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)
1. Complete Phase 1: Setup (`T001`-`T002`)
2. Complete Phase 2: Foundational (`T003`-`T004`)
3. Complete Phase 3: User Story 1 (`T005`-`T008`)
4. **STOP and VALIDATE**: Export a full template JSON file and verify contents outside the app.

### Incremental Delivery
1. Setup + Foundational ready.
2. User Story 1: Produces portable, inspectable JSON template file (MVP).
3. User Story 2: Consumes template file on clean install and recreates full financial setup.
4. User Story 3: Adds safe, non-destructive import into existing installations with duplicate flagging.
5. Polish: Validates large dataset performance and end-to-end regression safety.
