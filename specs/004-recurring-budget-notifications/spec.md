# Feature Specification: Recurring & Budget Notifications

**Feature Branch**: `004-recurring-budget-notifications`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "Local notifications for recurring/budget events — use the
Notification API + Service Worker (still zero-server) to alert 'rent due tomorrow' or '80%
of Dining budget used,' instead of requiring the user to open the dashboard."

## Clarifications

### Session 2026-09-06

- Q: Since this app has no server and browsers only reliably deliver notifications while
  something can wake the Service Worker (not guaranteed when the app/browser is fully
  closed), when should notifications actually fire? → A: On-open check — when the user opens
  the app (or it's already open), check for anything newly due/crossed and show
  notifications then; no guaranteed delivery while fully closed.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Upcoming Recurring Event Reminder (Priority: P1)

A user has a recurring rule (e.g., monthly rent). As its expected date approaches, the app
shows a notification reminding them, instead of the user having to remember to check the
dashboard or recurring page.

**Why this priority**: This is the most time-sensitive use case — missing a bill reminder
has real consequences, whereas a budget-threshold notice is informational.

**Independent Test**: Create a recurring rule due within the configured reminder window,
open (or bring to foreground) the app, and verify a notification appears referencing that
rule's name and due date, appearing only once per occurrence.

**Acceptance Scenarios**:

1. **Given** a recurring rule with an expected event due within the reminder window (e.g.,
   "due tomorrow"), **When** the user opens the app, **Then** a notification is shown naming
   the rule and its due date.
2. **Given** a notification has already been shown for a specific expected event, **When**
   the app is opened again before that event is resolved, **Then** the same notification is
   not shown a second time.
3. **Given** the user has not granted notification permission, **When** an event becomes
   due, **Then** the reminder is still visible within the app itself (e.g., on the dashboard)
   even though no system notification is shown.

---

### User Story 2 - Budget Threshold Alert (Priority: P2)

A user has an active budget for a category. Once spending crosses a threshold (e.g., 80% of
the budget), the app shows a notification calling this out.

**Why this priority**: Valuable for in-the-moment awareness of overspending risk, but less
time-critical than a bill coming due, since budget status is already visible on the
dashboard.

**Independent Test**: Set a budget, record transactions that cross the 80% threshold, open
the app, and verify a notification appears naming the category and the percentage used.

**Acceptance Scenarios**:

1. **Given** an active budget, **When** actual spending in its category crosses 80% of the
   budgeted amount, **Then** a notification is shown the next time the app is opened,
   naming the category and percentage used.
2. **Given** a threshold notification has already been shown for a budget's current period,
   **When** spending increases further within that same period, **Then** the same threshold
   is not re-notified (a higher threshold, e.g. 100%, may notify separately).
3. **Given** a new budget period begins, **When** spending in the new period later crosses
   80%, **Then** a fresh notification is shown for that new period.

---

### User Story 3 - Notification Preferences (Priority: P3)

A user turns notifications on or off overall, and adjusts the reminder lead time (e.g.,
"remind me 3 days before" instead of 1) and the budget threshold percentage that triggers an
alert.

**Why this priority**: Configurability is a refinement — the feature already delivers value
with sensible defaults (Stories 1 and 2) even before this exists.

**Independent Test**: Change the reminder lead time and budget threshold in settings, then
verify subsequent notifications respect the new values.

**Acceptance Scenarios**:

1. **Given** the user disables notifications in settings, **When** any recurring or budget
   event would otherwise trigger one, **Then** no system notification is shown.
2. **Given** the user changes the reminder lead time or budget threshold percentage, **When**
   the next qualifying event occurs, **Then** it uses the updated setting.

---

### Edge Cases

- What happens the first time the feature is used and the browser has not yet been asked for
  notification permission? The user must be clearly prompted to grant permission, with the
  app explaining why, and the feature must degrade to in-app-only reminders if denied.
- What happens when the app is not opened at all before an event's due date passes? Since
  delivery is tied to the app being opened (no server), the reminder for that occurrence is
  effectively missed as a system notification; the missed/overdue state must still be
  visible in-app (per the existing Recurring Finances feature) once the app is next opened.
- What happens when multiple events become due/crossed between one app open and the next?
  All qualifying notifications are shown (or grouped into a single summary notification),
  none silently dropped.
- What happens if the browser or OS blocks notifications globally? The app must not fail or
  error — it degrades to in-app indicators only.
- What happens when a recurring event that already triggered a reminder gets matched to an
  actual transaction before its due date? No further reminder is needed for that occurrence.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST request notification permission from the user, with an explanation
  of what it will be used for, before first attempting to show a notification.
- **FR-002**: When the app is opened (or already open and brought to the foreground), system
  MUST check for recurring expected events due within a configurable lead time and show a
  notification for each newly-qualifying event not already notified.
- **FR-003**: When the app is opened, system MUST check active budgets for the configured
  spending threshold and show a notification for each budget that has newly crossed it since
  the last check.
- **FR-004**: System MUST NOT show a duplicate notification for the same expected event or
  the same budget-period-threshold combination more than once.
- **FR-005**: Users MUST be able to enable or disable notifications entirely from settings.
- **FR-006**: Users MUST be able to configure the recurring-event reminder lead time (in
  days) and the budget-threshold percentage that triggers an alert.
- **FR-007**: If notification permission is denied or unsupported, system MUST still surface
  due/crossed events within the app's own UI (not only as a system notification).
- **FR-008**: System MUST NOT claim or imply guaranteed delivery while the app/browser is
  fully closed, since this is a zero-server, client-only application.

### Key Entities

- **Notification Preference** (part of the existing user/app settings): enabled/disabled
  flag, reminder lead time in days, budget threshold percentage.
- **Notification Log** (internal, not user-facing content): a record of which expected
  event / budget-period-threshold combinations have already been notified, to prevent
  duplicates.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of recurring events due within the configured lead time produce exactly
  one notification per occurrence, with zero duplicates, across repeated app opens.
- **SC-002**: 100% of budget-threshold crossings produce exactly one notification per
  budget-period-threshold combination.
- **SC-003**: A user can enable notifications and see their first reminder (using seeded
  test data due "tomorrow") in under 10 seconds of opening the app.
- **SC-004**: When notification permission is denied, 100% of due/crossed events are still
  visible somewhere in-app within one interaction (e.g., opening the dashboard).

## Assumptions

- Delivery model is "check on open," not guaranteed background delivery while the app is
  fully closed — consistent with the project's zero-server, no-background-sync constraint.
- Default reminder lead time is 1 day; default budget threshold is 80%, matching the
  examples in the feature description; both are user-adjustable per Story 3.
- Uses the standard browser Notification API together with the existing Service Worker;
  no third-party push service is introduced (would violate the zero-server principle).
