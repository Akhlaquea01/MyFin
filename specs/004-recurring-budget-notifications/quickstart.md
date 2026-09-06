# Quickstart: Recurring & Budget Notifications

Validation scenarios proving the feature works end-to-end, once implemented per
[plan.md](plan.md), [data-model.md](data-model.md), and
[contracts/notification-engine.md](contracts/notification-engine.md).

## Prerequisites

- App running locally (`npm run dev`) with onboarding completed.
- Browser notification permission granted (Playwright:
  `context.grantPermissions(['notifications'])`; manually: accept the browser's permission
  prompt after clicking "Enable" on the in-app banner). Notifications are enabled by default
  (data-model.md) — nothing to turn on in settings unless you want to change the defaults
  (Scenario 5) or turn the feature off (Scenario 6).

## Scenario 1 — Upcoming recurring reminder, shown once (User Story 1)

1. Create a recurring rule whose next expected occurrence falls due tomorrow (within the
   default 1-day lead time).
2. Unlock/open the app.
3. **Expect**: a system notification appears naming the rule's category and its due date.
4. Lock and unlock the app again (without resolving the event).
5. **Expect**: no second notification appears for the same occurrence (FR-004).

## Scenario 2 — Permission denied still surfaces the reminder in-app (Edge Case / FR-007)

1. With notification permission denied (or not yet granted), create the same kind of
   due-soon recurring rule as Scenario 1.
2. Unlock/open the app.
3. **Expect**: no system notification appears, and nothing errors; opening
   **Recurring → Upcoming** still shows the event with its `pending` status, exactly as it
   already does today.

## Scenario 3 — Budget threshold alert, shown once per period (User Story 2)

1. Create a budget with a planned amount of ₹10,000 for a category (default 80% threshold).
2. Record expense transactions in that category totaling ₹8,200 (82% of planned).
3. Unlock/open the app.
4. **Expect**: a system notification appears naming the category and "82% used".
5. Record another ₹500 expense in the same category/period.
6. Unlock/open the app again.
7. **Expect**: no second notification for crossing 80% again (FR-004) — a fresh notification
   would only occur if a _higher configured threshold_ value were newly crossed.

## Scenario 4 — A new period re-arms the same budget's alert (Acceptance Scenario, US2)

1. Advance to the budget's next period (a fresh `BudgetItem` with `actualAmount` reset).
2. Repeat Scenario 3's spending pattern in the new period.
3. **Expect**: a fresh notification appears for the new period, since the dedupe key
   includes `periodStart` (data-model.md).

## Scenario 5 — Changing preferences takes effect on the next check (User Story 3)

1. In the notification settings screen, change the reminder lead time from 1 to 3 days and
   the budget threshold from 80% to 50%.
2. Create a recurring rule due in 2 days (previously outside the 1-day window) and/or a
   budget at 55% spent (previously below the 80% threshold).
3. Unlock/open the app.
4. **Expect**: both now qualify and produce notifications, reflecting the updated settings
   immediately.

## Scenario 6 — Disabling notifications suppresses all dispatch (User Story 3)

1. In settings, turn notifications off entirely.
2. With qualifying due/crossed data present, unlock/open the app.
3. **Expect**: no system notification appears at all, even though the same data would have
   qualified with notifications enabled.

## Automated coverage

These scenarios correspond to:

- `tests/unit/notificationEngine.test.ts` — the pure `findDueRecurringEvents`/
  `findCrossedBudgetThresholds` logic behind Scenarios 1, 3, 4, 5 (lead-time and threshold
  boundaries, per-period dedupe key).
- `tests/integration/notificationRepositories.test.ts` — `NotificationPreferenceRepository`
  and `NotifiedItemRepository` (Scenario 5's persisted settings, Scenario 1/3's dedupe log).
- `tests/e2e/recurringBudgetNotifications.spec.ts` — Scenarios 1, 2, 3, 6 end-to-end, using
  Playwright's `context.grantPermissions(['notifications'])` (and omitting it, for Scenario 2) to control browser permission deterministically.
