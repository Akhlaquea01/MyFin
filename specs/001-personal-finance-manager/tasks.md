---
description: 'Task list for Personal Finance Manager (PWA)'
---

# Tasks: Personal Finance Manager (PWA)

**Input**: Design documents from `/specs/001-personal-finance-manager/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included. The project constitution's Principle IV (Test-First for Financial
Logic, NON-NEGOTIABLE) requires unit tests for every money-affecting engine before it is
considered done, plus integration tests for repositories and E2E coverage of core flows —
so test tasks are mandatory here, not optional.

**Organization**: Tasks are grouped by user story (from spec.md, P1–P9) to enable
independent implementation and testing of each story.

**Framework note (2026-09-06)**: File paths below use the React structure
(`src/pages/*.tsx`, `src/components/*.tsx`, `src/App.tsx`) after the UI layer was
rewritten from SvelteKit to React + shadcn/ui at the user's request — see plan.md's
Framework note and research.md #1–#2. `src/domain/` and `src/data/` paths are unaffected
(framework-agnostic TypeScript).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US9)
- File paths follow the Project Structure in [plan.md](plan.md)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic tooling

- [x] T001 Initialize SvelteKit + TypeScript + Vite project at repository root (`package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`), leaving `.specify/`, `.claude/`, `specs/` untouched
- [x] T002 [P] Install core dependencies: `dexie`, `papaparse`, `exceljs`, `file-saver`, `chart.js`, `tailwindcss`, `vite-plugin-pwa`
- [x] T003 [P] Configure Tailwind CSS (`tailwind.config.js`, `src/app.css`)
- [x] T004 [P] Configure ESLint + Prettier for TypeScript/Svelte
- [x] T005 [P] Configure Vitest (`vitest.config.ts`) and Playwright (`playwright.config.ts`), including `fake-indexeddb` for Node-based integration tests (research.md #10)
- [x] T006 Configure `vite-plugin-pwa` (manifest fields, icons in `static/`, `registerType: 'autoUpdate'`) in `vite.config.ts` (research.md #3)
- [x] T007 Create base directory structure per plan.md: `src/domain/`, `src/data/`, `src/lib/`, `src/components/`, `src/routes/`, `tests/unit/`, `tests/integration/`, `tests/e2e/`

**Checkpoint**: Project builds and runs an empty SvelteKit shell.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Cross-cutting infrastructure every user story depends on — encryption, the
database, and the app-wide security/availability gates (persistent storage, single-tab
lock) that apply before any feature-specific screen renders.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T008 Define Dexie database schema for all 16 entities in `src/data/dexie/db.ts` per [data-model.md](data-model.md)
- [x] T009 [P] Implement `CryptoService` (PBKDF2-SHA256 key derivation, AES-GCM encrypt/decrypt, PIN verifier hashing) in `src/data/crypto/cryptoService.ts` per [contracts/repository-interfaces.md](contracts/repository-interfaces.md) and research.md #6
- [x] T010 [P] Implement `UserProfileRepository` (Dexie adapter, singleton row) in `src/data/dexie/userProfileRepository.ts`
- [x] T011 Implement an encrypted-table helper that routes all Dexie reads/writes through `CryptoService` in `src/data/dexie/encryptedTable.ts` (depends on T008, T009)
- [x] T012 [P] Implement session/lock Svelte store (locked state, in-memory key holder, `autoLockTimeoutMs` countdown) in `src/lib/stores/sessionStore.ts`
- [x] T013 [P] Implement persistent-storage request helper (`navigator.storage.persist()`/`persisted()`) in `src/data/storage/persistence.ts` per research.md #4
- [x] T014 [P] Implement single-instance tab lock (Web Locks API; polling reacquire instead of a BroadcastChannel fallback — see research.md #5) in `src/lib/singleInstance.ts`
- [x] T015 Implement root layout gate (`src/App.tsx`) that enforces, in order: single-instance block screen → onboarding/PIN lock screen → storage-persistence warning banner → the requested route (depends on T012, T013, T014)
- [x] T016 [P] Strip all `console.*`/debug output in production via a runtime guard (`src/lib/disableConsoleInProd.ts`, imported from the root layout) rather than a bundler `drop` option — this Vite build's experimental Rolldown/oxc pipeline doesn't expose one — enforcing FR-006 / Constitution Principle II

**Checkpoint**: Foundation ready — encryption, storage, and app-wide gates work; user story implementation can now begin.

---

## Phase 3: User Story 1 - Secure Onboarding & App Lock (Priority: P1) 🎯 MVP

**Goal**: A first-time user sets a PIN, the app locks itself after inactivity or on
reopen, and no data is accessible without the correct PIN (optionally backed by
biometrics).

**Independent Test**: Install fresh, set a PIN, reopen/idle past 5 minutes, confirm the
app is locked and rejects a wrong PIN.

### Tests for User Story 1

> **Write these tests FIRST; confirm they FAIL before implementation.**

- [x] T017 [P] [US1] Unit test PIN hashing/verification and key derivation in `tests/unit/crypto.test.ts`
- [x] T018 [P] [US1] Integration test: PIN setup persists `UserProfile` and gates subsequent reads in `tests/integration/onboarding.test.ts`
- [x] T019 [P] [US1] E2E test: fresh install requires PIN, wrong PIN rejected, second tab blocked/recovers in `tests/e2e/onboarding.spec.ts`

### Implementation for User Story 1

- [x] T020 [US1] Build PIN setup screen (create + confirm PIN) as `src/components/OnboardingScreen.tsx`, rendered by the root layout gate rather than a navigable route (a security gate must not be bypassable by direct navigation to another route)
- [x] T021 [US1] Build PIN unlock screen as `src/components/LockScreen.tsx` (same reasoning as T020)
- [x] T022 [US1] Add WebAuthn biometric opt-in enrollment and unlock path in `src/lib/webauthn.ts` (PRF-extension-based PIN wrapping), wired into `src/components/LockScreen.tsx` and `src/components/BiometricEnrollmentPrompt.tsx` (PIN remains the fallback, FR-002)
- [x] T023 [US1] Wire the auto-lock timer (reset on user activity, lock at `autoLockTimeoutMs`) into `src/lib/stores/sessionStore.ts`
- [x] T024 [US1] Build the storage-persistence warning banner component in `src/components/StorageWarningBanner.tsx`
- [x] T025 [US1] Build the multi-tab "already open elsewhere" blocked-state screen as `src/components/BlockedScreen.tsx` (same reasoning as T020)

**Checkpoint**: User Story 1 is fully functional and independently testable — the app can be installed, locked, and unlocked.

---

## Phase 4: User Story 2 - Core Ledger: Accounts, Categories & Transactions (Priority: P2)

**Goal**: Users create accounts, record income/expense transactions and transfers, split
and tag transactions, and search/trash them.

**Independent Test**: Create two accounts, record transactions and a transfer, verify
balances and that the transfer isn't double-counted.

### Tests for User Story 2

- [x] T026 [P] [US2] Unit test transaction engine (balance recalculation, split-sum validation, transfer pairing/exclusion) in `tests/unit/transactionEngine.test.ts`
- [x] T027 [P] [US2] Unit test duplicate-detection rule (same account + amount + date within ±1 day) in `tests/unit/duplicateDetection.test.ts`
- [x] T028 [P] [US2] Integration test `AccountRepository` + `TransactionRepository` against Dexie in `tests/integration/ledgerRepositories.test.ts`
- [x] T029 [P] [US2] E2E test: create accounts, record transactions, transfer, split, soft-delete/restore in `tests/e2e/ledger.spec.ts`

### Implementation for User Story 2

- [x] T030 [P] [US2] Implement `AccountRepository` (Dexie adapter, incl. `hasActiveTransactions` delete guard) in `src/data/dexie/accountRepository.ts`
- [x] T031 [P] [US2] Implement `CategoryRepository` (hierarchical) in `src/data/dexie/categoryRepository.ts`
- [x] T032 [P] [US2] Implement `MerchantRepository` + `MerchantAliasRepository` in `src/data/dexie/merchantRepository.ts`
- [x] T033 [P] [US2] Implement `TagRepository` + transaction-tag join handling in `src/data/dexie/tagRepository.ts`
- [x] T034 [US2] Implement `TransactionRepository` (splits, transfer pairing, soft delete/restore, `findPossibleDuplicates`) in `src/data/dexie/transactionRepository.ts` (depends on T030–T033)
- [x] T035 [US2] Implement the transaction domain engine (create/edit/delete orchestration, balance recalculation, transfer creation) in `src/domain/transactions/transactionEngine.ts` (depends on T034)
- [x] T036 [US2] Build Accounts UI (list/create/edit/archive) in `src/pages/AccountsPage.tsx`
- [x] T037 [US2] Build transaction entry form (amount, date, account, category, splits, tags, merchant) in `src/pages/NewTransactionPage.tsx`
- [x] T038 [US2] Build transaction list with search/filter (date, account, category, tag, free-text) in `src/pages/TransactionsPage.tsx`
- [x] T039 [US2] Build transfer entry UI in `src/pages/TransferPage.tsx`
- [x] T040 [US2] Build trash/undo UI for soft-deleted transactions and accounts in `src/pages/TrashPage.tsx`
- [x] T041 [US2] Build category management UI (hierarchy, icons) in `src/pages/CategoriesPage.tsx`

**Checkpoint**: User Stories 1 AND 2 both work independently — a usable manual ledger exists.

---

## Phase 5: User Story 3 - Smart Dashboard (Priority: P3)

**Goal**: An at-a-glance summary of balances, net worth, recent activity, unreviewed
items, upcoming events, and budget status.

**Independent Test**: With existing ledger data, verify every dashboard figure matches a
manual recomputation.

### Tests for User Story 3

- [x] T042 [P] [US3] Unit test dashboard aggregation (balances, net worth, unreviewed count) in `tests/unit/dashboardAggregation.test.ts`
- [x] T043 [P] [US3] E2E test dashboard reconciles exactly with ledger data in `tests/e2e/dashboard.spec.ts`

### Implementation for User Story 3

- [x] T044 [US3] Implement dashboard aggregation service in `src/domain/analytics/dashboardService.ts` (depends on T034, T035) — upcoming-events/budget-status sections deferred to US5/US6 (no data model for them yet); net worth is cash-only until US7 adds investments/liabilities
- [x] T045 [US3] Build Dashboard UI (balance/net worth cards, recent transactions, unreviewed count) in `src/pages/DashboardPage.tsx`
- [x] T046 [P] [US3] Build a reusable sparkline/mini-chart component (Chart.js) in `src/components/Sparkline.tsx`

**Checkpoint**: Dashboard is live and reconciles with the ledger.

---

## Phase 6: User Story 4 - Quick Add & Bulk Text Import (Priority: P4)

**Goal**: Paste a payment-notification-style text (or import a batch of them) and get a
proposed, reviewable transaction, with duplicates and low-confidence text handled safely.

**Independent Test**: Paste a sample text and verify a correct proposed transaction;
import a batch file and verify unreviewed transactions with duplicates flagged.

### Tests for User Story 4

- [x] T047 [P] [US4] Unit test `QuickAddParser` (amount/merchant/type extraction, confidence threshold) in `tests/unit/quickAddParser.test.ts`
- [x] T048 [P] [US4] Integration test bulk text import creates unreviewed transactions and flags duplicates in `tests/integration/bulkTextImport.test.ts`
- [x] T049 [P] [US4] E2E test Quick Add paste flow and duplicate flagging in `tests/e2e/quickAdd.spec.ts`

### Implementation for User Story 4

- [x] T050 [US4] Implement `QuickAddParser` (rule-based regex/heuristics + confidence score) in `src/domain/parser/quickAddParser.ts` per research.md #9
- [x] T051 [US4] Implement merchant-alias resolution during parsing in `src/domain/parser/merchantResolver.ts` (depends on T032, T050)
- [x] T052 [US4] Implement bulk text file import (`ImportService.importBulkText`) in `src/data/io/bulkTextImportService.ts` (depends on T050, T034)
- [x] T053 [US4] Build Quick Add UI (paste field, proposed-transaction confirmation) in `src/pages/QuickAddPage.tsx`
- [x] T054 [US4] Build the unreviewed-transaction review queue UI in `src/pages/ReviewPage.tsx`
- [x] T055 [US4] Build bulk text import UI (file picker + results summary) in `src/pages/BulkTextImportPage.tsx`

**Checkpoint**: Quick Add and bulk text import are functional.

---

## Phase 7: User Story 5 - Budgeting (Priority: P5)

**Goal**: Set category budgets with optional rollover/sinking funds and track actual
spend against them.

**Independent Test**: Set a budget, record matching transactions, verify actual-vs-planned
matches exactly.

### Tests for User Story 5

- [x] T056 [P] [US5] Unit test budget engine (actual-vs-planned, rollover, sinking-fund accumulation, overspend detection) in `tests/unit/budgetEngine.test.ts`
- [x] T057 [P] [US5] Integration test `BudgetRepository`/`BudgetItemRepository` against Dexie in `tests/integration/budgetRepositories.test.ts`
- [x] T058 [P] [US5] E2E test set-budget → record-spend → verify actual-vs-planned in `tests/e2e/budgeting.spec.ts`

### Implementation for User Story 5

- [x] T059 [P] [US5] Implement `BudgetRepository` + `BudgetItemRepository` (Dexie adapters) in `src/data/dexie/budgetRepository.ts`
- [x] T060 [US5] Implement the budget engine (period rollover, sinking funds, actual-amount recalculation triggered by transaction changes) in `src/domain/budgets/budgetEngine.ts` (depends on T059, T035)
- [x] T061 [US5] Build budget management UI (set/edit budgets, rollover/sinking-fund toggle) in `src/pages/BudgetsPage.tsx`
- [x] T062 [US5] Build budget progress UI (actual vs planned, overspend indicator) in `src/components/BudgetProgressCard.tsx`

**Checkpoint**: Budgeting is functional.

---

## Phase 8: User Story 6 - Recurring Finances (Priority: P6)

**Goal**: Define recurring rules, see expected upcoming events, auto-match them to actual
transactions, and flag missed ones.

**Independent Test**: Create a recurring rule, verify an expected event, record a matching
transaction, verify linkage, and verify a missed occurrence is flagged.

### Tests for User Story 6

- [x] T063 [P] [US6] Unit test recurring engine (expected-event generation, matching, missed detection) in `tests/unit/recurringEngine.test.ts`
- [x] T064 [P] [US6] Integration test `RecurringRepository` against Dexie in `tests/integration/recurringRepository.test.ts`
- [x] T065 [P] [US6] E2E test recurring rule → expected event → match → missed flag in `tests/e2e/recurring.spec.ts`

### Implementation for User Story 6

- [x] T066 [P] [US6] Implement `RecurringRepository` (Dexie adapter) in `src/data/dexie/recurringRepository.ts`
- [x] T067 [US6] Implement the recurring domain engine (`generateExpectedEvents`, `matchTransaction`, `markMissedPastDue`) in `src/domain/recurring/recurringEngine.ts` (depends on T066, T034)
- [x] T068 [US6] Hook transaction creation into recurring-event matching in `src/domain/transactions/transactionEngine.ts` (depends on T035, T067)
- [x] T069 [US6] Build recurring-rules management UI in `src/pages/RecurringPage.tsx`
- [x] T070 [US6] Build upcoming/expected-events UI (list, missed flag) in `src/pages/RecurringUpcomingPage.tsx`

**Checkpoint**: Recurring finances are functional.

---

## Phase 9: User Story 7 - Wealth & Debt Tracking (Priority: P7)

**Goal**: Track investment holdings, valuations, and liabilities, and compute net worth
as assets minus liabilities over time.

**Independent Test**: Add a holding+valuation and a liability, verify net worth equals
assets minus liabilities.

### Tests for User Story 7

- [x] T071 [P] [US7] Unit test net worth calculation (assets − liabilities) in `tests/unit/wealthEngine.test.ts`
- [x] T072 [P] [US7] Integration test `WealthRepository` (holdings, valuations, liabilities, snapshots) against Dexie in `tests/integration/wealthRepository.test.ts`
- [x] T073 [P] [US7] E2E test add holding + liability → verify net worth in `tests/e2e/wealth.spec.ts`

### Implementation for User Story 7

- [x] T074 [P] [US7] Implement `WealthRepository` (Dexie adapter for holdings/valuations/liabilities/snapshots) in `src/data/dexie/wealthRepository.ts`
- [x] T075 [US7] Implement the wealth domain engine (`computeNetWorth`, `netWorthHistory`, snapshot recording) in `src/domain/wealth/wealthEngine.ts` (depends on T074, T030)
- [x] T076 [US7] Build investment holdings UI (add holding, record valuation) in `src/pages/InvestmentsPage.tsx`
- [x] T077 [US7] Build liabilities UI (add loan/credit card, outstanding balance, EMI) in `src/pages/LiabilitiesPage.tsx`
- [x] T078 [US7] Build net worth summary + history UI in `src/pages/NetWorthPage.tsx`

**Checkpoint**: Wealth & debt tracking is functional.

---

## Phase 10: User Story 8 - Analytics & Reporting (Priority: P8)

**Goal**: Visual breakdowns of spending, income/expense trends, cash flow, budget
performance, and net worth trend over selectable ranges.

**Independent Test**: With multi-month data, verify analytics totals match manual
aggregation of the underlying transactions.

### Tests for User Story 8

- [x] T079 [P] [US8] Unit test analytics aggregation (category breakdown, income/expense trend, cash flow) in `tests/unit/analyticsEngine.test.ts`
- [x] T080 [P] [US8] E2E test analytics figures match underlying ledger/budget/wealth data in `tests/e2e/analytics.spec.ts`

### Implementation for User Story 8

- [x] T081 [US8] Implement the analytics domain engine (category breakdown, trends, cash flow, budget performance, net worth trend) in `src/domain/analytics/analyticsEngine.ts` (depends on T035, T060, T075)
- [x] T082 [US8] Build Analytics UI with Chart.js visualizations in `src/pages/AnalyticsPage.tsx`
- [x] T083 [P] [US8] Build a reusable time-range selector component in `src/components/DateRangeSelector.tsx`

**Checkpoint**: Analytics & reporting is functional.

---

## Phase 11: User Story 9 - Import/Export & Backup-Restore (Priority: P9)

**Goal**: Column-mapped CSV/XLSX import and export, plus full encrypted backup/restore
(including onto a different device), with corrupted or unsupported backups safely
rejected.

**Independent Test**: Import a CSV with column mapping; back up, wipe local data, restore,
and verify an exact match. Verify a corrupted backup is rejected without side effects.

### Tests for User Story 9

- [x] T084 [P] [US9] Unit test CSV/XLSX column-mapping import (malformed-row reporting, duplicate flagging) in `tests/unit/importService.test.ts`
- [x] T085 [P] [US9] Unit test backup encode/decode, checksum verification, and schema migration in `tests/unit/backupService.test.ts`
- [x] T086 [P] [US9] Integration test a full backup-then-restore round trip against Dexie in `tests/integration/backupRestore.test.ts`
- [x] T087 [P] [US9] E2E test CSV import, export, backup, restore, and corrupted-backup rejection in `tests/e2e/importExportBackup.spec.ts`

### Implementation for User Story 9

- [x] T088 [P] [US9] Implement the CSV/XLSX `ImportService` (Papa Parse + exceljs, column mapping, preview) in `src/data/io/importService.ts` per [contracts/csv-import-contract.md](contracts/csv-import-contract.md)
- [x] T089 [P] [US9] Implement the CSV/XLSX `ExportService` in `src/data/io/exportService.ts`
- [x] T090 [US9] Implement `BackupService` (create/validate/restore, schema versioning + forward migration) in `src/data/io/backupService.ts` per [contracts/backup-format.md](contracts/backup-format.md) (depends on T009)
- [x] T091 [P] [US9] Implement the first schema migration stub in `src/data/io/migrations/v1.ts`
- [x] T092 [US9] Build import UI (file picker, column mapping, preview, results summary) in `src/pages/ImportPage.tsx`
- [x] T093 [US9] Build export UI in `src/pages/ExportPage.tsx`
- [x] T094 [US9] Build backup/restore UI (create backup, restore from file, manual/auto-backup toggle) in `src/pages/BackupSettingsPage.tsx`

**Checkpoint**: All 9 user stories are independently functional.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that span multiple user stories.

- [x] T095 [P] Accessibility pass (keyboard navigation, contrast, semantic markup) across all routes
- [x] T096 [P] Responsive/mobile-first layout pass across all routes
- [x] T097 Performance: virtualized rendering for the transaction list at 10k+ rows in `src/pages/TransactionsPage.tsx` (SC-008)
- [x] T098 Run the full [quickstart.md](quickstart.md) validation across all 10 scenarios
- [x] T099 [P] Finalize PWA icons/splash screens and manifest metadata in `static/`
- [x] T100 Final release check: verify stripped console/debug output (FR-006), persistent-storage behavior, and multi-tab blocking on real Android/iOS/desktop browsers

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Stories (Phase 3–11)**: All depend on Foundational completion.
  - US1 has no dependency on other stories.
  - US2 depends only on Foundational (uses `CryptoService`, Dexie schema, session store).
  - US3 (Dashboard) reads US2's repositories/engine — implement after US2 for real data to show, though its own code has no hard compile-time dependency on US2's UI.
  - US4 (Quick Add) reads/writes through US2's `TransactionRepository` — implement after US2.
  - US5 (Budgeting) depends on US2's transaction engine for actual-spend recalculation.
  - US6 (Recurring) depends on US2's transaction engine for matching.
  - US7 (Wealth) depends on US2's `AccountRepository` for total-assets calculation.
  - US8 (Analytics) depends on US2, US5, and US7's engines for the data it aggregates.
  - US9 (Import/Export/Backup) depends on US2's repositories (import targets) and T009's `CryptoService` (backup encryption); independent of US3–US8 otherwise.
- **Polish (Phase 12)**: Depends on all desired user stories being complete.

### Within Each User Story

- Tests are written first and MUST fail before implementation begins (Constitution
  Principle IV).
- Repositories before domain engines; domain engines before UI.
- Story complete and checkpointed before moving to the next priority (if working
  sequentially).

### Parallel Opportunities

- All Setup tasks marked `[P]` run in parallel.
- All Foundational tasks marked `[P]` (T009, T010, T012, T013, T014, T016) run in parallel once T008 exists.
- Within US2, repositories T030–T033 run in parallel (different files) before T034.
- Across stories: US3, US4, US5, US6, US7 can be staffed in parallel once US2 is
  checkpointed, since each depends on US2's engine but not on each other. US8 must wait
  for US5 and US7. US9 can start in parallel with US3–US8 (only needs US2 + Foundational).

---

## Parallel Example: User Story 2

```bash
# Launch all tests for User Story 2 together:
Task: "Unit test transaction engine in tests/unit/transactionEngine.test.ts"
Task: "Unit test duplicate-detection rule in tests/unit/duplicateDetection.test.ts"
Task: "Integration test AccountRepository + TransactionRepository in tests/integration/ledgerRepositories.test.ts"
Task: "E2E test ledger flows in tests/e2e/ledger.spec.ts"

# Launch independent repository implementations together:
Task: "Implement AccountRepository in src/data/dexie/accountRepository.ts"
Task: "Implement CategoryRepository in src/data/dexie/categoryRepository.ts"
Task: "Implement MerchantRepository + MerchantAliasRepository in src/data/dexie/merchantRepository.ts"
Task: "Implement TagRepository in src/data/dexie/tagRepository.ts"
```

---

## Implementation Strategy

### MVP First

The strict spec-kit MVP is **User Story 1 alone** (Setup → Foundational → Phase 3): it is
independently valuable (a securely lockable, installable, empty PWA) and independently
testable per its own Independent Test criterion.

In practice, a _usable_ first release needs **User Story 1 + User Story 2** (Setup →
Foundational → Phase 3 → Phase 4): that combination is the first point at which a user can
actually track their finances, matching the spec's own M1+M2 framing.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → test independently → deploy/demo (strict MVP).
3. US2 → test independently → deploy/demo (first genuinely useful release).
4. US3 → US4 → US5 → US6 → US7 → US8 → US9, each tested and checkpointed independently,
   in priority order.

### Parallel Team Strategy

Once Foundational and US2 are both checkpointed, US3 through US7 have no dependencies on
each other and can be assigned to different developers simultaneously; US8 waits on US5
and US7; US9 only waits on US2 and Foundational, so it can run in parallel with US3–US8.

---

## Notes

- `[P]` tasks touch different files with no unmet dependencies.
- `[Story]` labels map every user-story-phase task back to spec.md for traceability.
- Tests are written first and must fail before their corresponding implementation task,
  per Constitution Principle IV.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently before continuing.
