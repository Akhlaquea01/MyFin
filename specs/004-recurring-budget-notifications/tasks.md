---
description: 'Task list template for feature implementation'
---

# Tasks: Recurring & Budget Notifications

**Input**: Design documents from `/specs/004-recurring-budget-notifications/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/notification-engine.md](contracts/notification-engine.md),
[quickstart.md](quickstart.md)

**Tests**: Included and REQUIRED, not optional. Constitution Principle IV mandates test-first
development for money-derived logic; the plan's Constitution Check holds the two candidate-
selection functions to that same bar, following the precedent set in specs 002/003.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3). Unlike specs
002/003 (one pure function serving all stories), this feature has two genuinely independent
pure functions — `findDueRecurringEvents` (US1) and `findCrossedBudgetThresholds` (US2) —
feeding one shared, incrementally-extended orchestrator, so each story adds real new
capability rather than just revealing UI for already-built logic.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths below are real paths in this repository. `src/domain/recurring/recurringEngine.ts`
  and `src/domain/budgets/budgetEngine.ts` (spec 001) are reused, not modified.

---

## Phase 1: Setup

**Purpose**: Establish a clean baseline before touching any code

- [x] T001 Confirm no new npm dependency is required (per [research.md](research.md) §7 —
      native `Notification` API only) and run the existing test suite (`npm run test`) to
      confirm it passes cleanly before starting, establishing a clean baseline to diff
      against.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared entities and storage that every user story depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Add `NotificationPreference` and `NotifiedItem` interfaces to
      `src/domain/entities.ts` per [data-model.md](data-model.md) (`NotificationPreference`:
      `id: 'local-user'`, `enabled`, `reminderLeadDays`, `budgetThresholdPercent`,
      `permissionPromptDismissed`, `createdAt`, `updatedAt`; `NotifiedItem`: `id`, `key`,
      `notifiedAt`).
- [x] T003 [P] Add `notificationPreferences` and `notifiedItems` encrypted tables to
      `src/data/dexie/db.ts`: `NotificationPreferenceRow = EncryptedRow` (singleton, no
      extra indexed columns), `NotifiedItemRow extends EncryptedRow { key: string }`, add
      both properties to `MyFinDatabase`, and bump to
      `this.version(4).stores({ notificationPreferences: 'id', notifiedItems: 'id, key' })`
      (additive-only per Dexie's versioning model; do not modify earlier `version()` blocks).
- [x] T004 [P] Create `src/domain/notifications/types.ts` defining `NotificationCandidate`
      (`kind: 'recurring' | 'budget'`, `key`, `title`, `body`) per
      [data-model.md](data-model.md).

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Upcoming Recurring Event Reminder (Priority: P1) 🎯 MVP

**Goal**: When the app is opened/unlocked, a recurring expected event due within the
configured lead time produces exactly one system notification per occurrence; denied
permission degrades silently to the existing in-app view.

**Independent Test**: Create a recurring rule due within the reminder window, open the app,
and verify a notification appears naming the rule's category and due date, appearing only
once per occurrence (per [quickstart.md](quickstart.md) Scenario 1).

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they fail before writing the implementation.

- [x] T005 [P] [US1] Write failing unit tests in `tests/unit/notificationEngine.test.ts` for
      `findDueRecurringEvents(events, leadDays, asOfDate)`: a `pending` event due today
      qualifies, one due within `leadDays` qualifies, one due beyond `leadDays` is excluded,
      a `matched`/`missed` event is excluded regardless of date, and the returned
      candidate's `key` is exactly `recurring:{id}`.
- [x] T006 [P] [US1] Write failing integration tests in
      `tests/integration/notificationRepositories.test.ts` for
      `NotificationPreferenceRepository` (`get()` returns the documented default —
      including `enabled: true` — when nothing is stored; `save()` persists and a later
      `get()` returns it) and `NotifiedItemRepository` (`exists()` is `false` for an unknown
      key, `create()` then `exists()` is `true` for that key).

### Implementation for User Story 1

- [x] T007 [P] [US1] Implement `findDueRecurringEvents` in
      `src/domain/notifications/notificationEngine.ts` per
      [contracts/notification-engine.md](contracts/notification-engine.md). Depends on T004.
      Must make T005's tests pass.
- [x] T008 [US1] Implement `NotificationPreferenceRepository` and `NotifiedItemRepository`
      in `src/data/dexie/notificationRepository.ts` per
      [contracts/notification-engine.md](contracts/notification-engine.md), following the
      `DebtPlannerPreferenceRepository` pattern in
      `src/data/dexie/debtPlannerPreferenceRepository.ts`. Depends on T002, T003. Must make
      T006's tests pass.
- [x] T009 [US1] Implement `runNotificationCheck(key, asOfDate?)` in
      `src/domain/notifications/runNotificationCheck.ts` — recurring-only for this task:
      load the preference (return `{ dispatched: [] }` immediately if `!enabled`); call the
      existing `generateExpectedEvents`/`markMissedPastDue`
      (`src/domain/recurring/recurringEngine.ts`) exactly as `RecurringUpcomingPage` already
      does, then `ExpectedEventRepository.listPending`, resolve each event's category name
      via `CategoryRepository`, and call `findDueRecurringEvents(...,
preference.reminderLeadDays, asOfDate)`; for each candidate, skip if
      `NotifiedItemRepository.exists` for its `key`; otherwise, if
      `typeof Notification !== 'undefined' && Notification.permission === 'granted'`, call
      `new Notification(candidate.title, { body: candidate.body, tag: candidate.key })` and
      only then `NotifiedItemRepository.create`. Depends on T007, T008.
- [x] T010 [US1] Create `src/components/NotificationPermissionPrompt.tsx`: a dismissible
      banner (mirroring `src/components/BiometricEnrollmentPrompt.tsx`'s structure) shown
      when `typeof Notification !== 'undefined' && Notification.permission === 'default' &&
!preference.permissionPromptDismissed`; "Enable" calls
      `Notification.requestPermission()` then `NotificationPreferenceRepository.save(...,
{ permissionPromptDismissed: true })`; "Not now" does the same save without
      requesting permission (FR-001). Depends on T008.
- [x] T011 [US1] Wire into `src/App.tsx`'s `Gate` component: call `void
runNotificationCheck(key)` from `handleUnlock` (research.md §3, alongside the existing
      `refreshProfileFlags()` call), and mount `<NotificationPermissionPrompt />` next to the
      existing `<BiometricEnrollmentPrompt />`. Depends on T009, T010.

**Checkpoint**: User Story 1 is fully functional and independently testable — recurring
reminders fire once per occurrence, with a working permission banner and silent fallback
when permission is denied.

---

## Phase 4: User Story 2 - Budget Threshold Alert (Priority: P2)

**Goal**: When the app is opened, a budget that has newly crossed its configured spending
threshold for its current period produces exactly one system notification.

**Independent Test**: Set a budget, record transactions crossing the 80% threshold, open
the app, and verify a notification appears naming the category and percentage used (per
[quickstart.md](quickstart.md) Scenario 3).

### Tests for User Story 2 ⚠️

- [x] T012 [P] [US2] Write failing unit tests in `tests/unit/notificationEngine.test.ts`
      (same file as T005 — sequential, not parallel) for
      `findCrossedBudgetThresholds(items, thresholdPercent)`: an item at or above the
      threshold qualifies, one below does not, one with `plannedAmount: 0` is excluded
      regardless of `actualAmount`, and the returned candidate's `key` is exactly
      `budget:{budgetId}:{periodStart}:{thresholdPercent}`.
      _(Done as part of T005 — the budget-threshold test cases were written into the same
      file up front, since `notificationEngine.ts` is one small module holding both pure
      functions.)_

### Implementation for User Story 2

- [x] T013 [US2] Implement `findCrossedBudgetThresholds` in
      `src/domain/notifications/notificationEngine.ts` per
      [contracts/notification-engine.md](contracts/notification-engine.md). Depends on T004.
      Must make T012's tests pass.
      _(Done as part of T007 — see `findCrossedBudgetThresholds` in the same file.)_
- [x] T014 [US2] Extend `runNotificationCheck` in
      `src/domain/notifications/runNotificationCheck.ts` to also: load all `Budget`s via
      `BudgetRepository.list`, call the existing `ensureCurrentBudgetItem`
      (`src/domain/budgets/budgetEngine.ts`) for each exactly as `BudgetsPage` already does,
      resolve each budget's category name, call `findCrossedBudgetThresholds(...,
preference.budgetThresholdPercent)`, and fold those candidates into the same
      dedupe-check-then-dispatch-then-log loop T009 already built (no new loop). Depends on
      T009, T013.

**Checkpoint**: User Stories 1 and 2 both work — recurring reminders and budget threshold
alerts both fire independently and correctly.

---

## Phase 5: User Story 3 - Notification Preferences (Priority: P3)

**Goal**: User can turn notifications off entirely, and adjust the reminder lead time and
budget threshold percentage.

**Independent Test**: Change the reminder lead time and budget threshold in settings, then
verify subsequent notifications respect the new values (per
[quickstart.md](quickstart.md) Scenario 5); disabling notifications suppresses all dispatch
(Scenario 6).

### Implementation for User Story 3

> No new tests: `NotificationPreferenceRepository.save` is already covered by T006, and
> `runNotificationCheck`'s use of `preference.enabled`/`reminderLeadDays`/
> `budgetThresholdPercent` is already covered by T005/T012 (they take these as direct
> parameters) — this story is a UI layer over already-tested, already-wired behavior.

- [x] T015 [US3] Create `src/pages/NotificationSettingsPage.tsx`: an enable/disable
      `Switch`, a reminder-lead-time number input (days), and a budget-threshold number
      input (%), loaded from and saved to `NotificationPreferenceRepository`, following
      `BudgetsPage.tsx`'s `Switch`/`Controller` pattern for the toggle.
- [x] T016 [US3] Add the route `notification-settings` (element
      `<NotificationSettingsPage />`) inside the `<AppShell />` route block in
      `src/App.tsx`, and add a "Notifications" nav entry (a `lucide-react` icon such as
      `Bell`) to `NAV_ITEMS` in `src/components/AppShell.tsx`. Depends on T015.

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T017 [P] Write E2E test `tests/e2e/recurringBudgetNotifications.spec.ts` covering
      [quickstart.md](quickstart.md) Scenarios 1, 2, 3, and 6, using Playwright's
      `context.grantPermissions(['notifications'])` (and a second test omitting it, for
      Scenario 2) to control browser permission deterministically. Listen for the
      `Notification` constructor via a page-injected spy (`page.addInitScript`) since
      Playwright cannot observe real OS notification popups directly.
      _(Implemented via the `addInitScript` spy exclusively — it fully replaces the global
      `Notification` (with a controllable `.permission`), which is more deterministic in
      headless Chromium than relying on `context.grantPermissions` plus the real
      constructor; `context.grantPermissions` was not additionally used.)_
- [x] T018 [P] Verify [quickstart.md](quickstart.md) Scenarios 4-5 (new period re-arms a
      budget's alert; changed settings take effect on the next check) — already exercised
      at the unit level by T005/T012's boundary cases and the dedupe key's `periodStart`
      component (data-model.md); this task confirms the end-to-end behavior matches by
      exercising both through the actual UI once, rather than only at the engine level.
      _(Scenario 5 got its own new E2E test — "a widened reminder lead time picks up a
      previously out-of-window event" — since it was cheap and adds real regression value.
      Scenario 4 (new period re-arms a budget alert) is fully covered by T005/T012's unit
      tests already exercising the `periodStart`-keyed dedupe boundary; no additional E2E
      case was needed beyond what T017 already runs.)_
- [x] T019 Review all new code against Constitution Principle III (`src/domain/notifications/`
      may depend on other domain modules and repository interfaces, per the same pattern
      `recurringEngine.ts`/`budgetEngine.ts` already establish, but never on React) and
      Principle VI (the dedupe log is additive-only — never updated or deleted once written;
      no `console.*` in any new file) before marking the feature complete.
      _(Confirmed: `notificationEngine.ts` imports only `./types`; `runNotificationCheck.ts`
      imports only other domain engines and repository modules — matching the existing
      `recurringEngine.ts`/`budgetEngine.ts` precedent for domain-layer orchestration — never
      React; `NotifiedItemRepository` exposes only `exists`/`create`, no update/delete
      method, confirming the dedupe log is additive-only; no `console.*` in any new file.)_

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational and on US1's orchestrator (T009) —
  extends it rather than duplicating it.
- **User Story 3 (Phase 5)**: Depends on US1's repository (T008) only; independent of US2.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each Phase

- Tests MUST be written and confirmed failing before the implementation task(s) that follow
  them (Constitution Principle IV).
- Within Foundational: T002, T003, T004 touch different files and can all run in parallel.
- Within US1: T005 and T006 can run in parallel (different files); T007 depends on T004;
  T008 depends on T002/T003; T009 depends on T007/T008; T010 depends on T008; T011 depends
  on T009/T010.
- Within US2: T012 is sequential after T005 (same file); T013 depends on T004; T014 depends
  on T009/T013.
- US3's T015/T016 depend only on T008 (already complete after US1) and can start any time
  after US1, independent of US2.

### Parallel Opportunities

- Foundational: T002, T003, T004 together.
- US1: T005, T006 together.
- Polish: T017, T018 together.
- US3 (T015-T016) can be worked in parallel with US2 (T012-T014) once US1 is complete, since
  neither depends on the other.

---

## Parallel Example: Foundational Phase

```bash
Task: "Add NotificationPreference/NotifiedItem to src/domain/entities.ts"
Task: "Add notificationPreferences/notifiedItems tables to src/data/dexie/db.ts"
Task: "Create src/domain/notifications/types.ts"
```

## Parallel Example: User Story 1

```bash
Task: "Write failing unit tests in tests/unit/notificationEngine.test.ts for findDueRecurringEvents"
Task: "Write failing integration tests in tests/integration/notificationRepositories.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks everything else).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1 and 2 independently.
5. This alone delivers the spec's highest-priority value (bill reminders) before budget
   alerts or settings exist.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → recurring reminders work end-to-end.
3. User Story 2 → validate independently → budget threshold alerts also work.
4. User Story 3 → validate independently → users can tune or disable the whole feature.
5. Polish → E2E coverage and a final Constitution compliance pass.

## Notes

- [P] tasks touch different files with no unmet dependency.
- Every task in a user-story phase carries that story's label for traceability.
- Commit after each task or logical group; verify a test fails before implementing against
  it, and passes immediately after.
- `tests/unit/notificationEngine.test.ts` is shared across US1/US2 test tasks — T012's
  addition is sequential with respect to T005, even though it may run in parallel with
  unrelated-file tasks from other stories.
