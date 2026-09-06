# Phase 0 Research: Recurring & Budget Notifications

## 1. Splitting pure candidate-selection from I/O (Constitution Principle III/IV)

**Decision**: Two pure functions in `src/domain/notifications/notificationEngine.ts` —
`findDueRecurringEvents(events, leadDays, asOfDate)` (pending events with `expectedDate <=
addDays(asOfDate, leadDays)`) and `findCrossedBudgetThresholds(items, thresholdPercent)`
(items with `plannedAmount > 0` and `actualAmount / plannedAmount * 100 >= thresholdPercent`)
— take already-fetched plain data and return candidates, with no I/O. A separate impure
orchestrator, `runNotificationCheck()`, does the actual repository reads, calls these pure
functions, de-duplicates against the notification log, and dispatches the browser
Notification API.

**Rationale**: Mirrors the pattern already established by spec 002's `generatePlan.ts` and
spec 003's `goalProgress.ts` — the money-derived decision logic (has this bill come due, has
this budget crossed its line) is exactly the kind of thing Constitution Principle IV's
rationale cares about getting right and testable, even though notifications themselves are
informational rather than money-moving. Keeping it pure means it can be unit-tested with
plain fixtures, with the un-testable-without-a-browser parts (permission state, the
`Notification` constructor, Dexie reads) isolated in one thin orchestrator.

**Alternatives considered**: Computing everything inline inside the UI trigger point —
rejected, would leave the actual selection logic untested and coupled to React.

## 2. De-duplication log: only written after an actual dispatch

**Decision**: A single new encrypted table, `notifiedItems` (`id`, `key: string`,
`notifiedAt: number`), with `key` indexed. A candidate's dedupe key is `recurring:
{expectedEventId}` for a recurring reminder, or `budget:{budgetId}:{periodStart}:
{thresholdPercent}` for a budget threshold. `runNotificationCheck()` only writes a
`NotifiedItem` row **after** successfully calling `new Notification(...)` — i.e., only when
`Notification.permission === 'granted'`. If permission is denied or not yet requested, a
qualifying candidate is simply re-evaluated (and still not dispatched) on the next check,
rather than being silently marked "handled" for a notification that never actually appeared.

**Rationale**: FR-004's "MUST NOT show a duplicate" is about the system notification, not
about internal bookkeeping — logging a suppressed candidate as if it had been shown would
mean a user who _later_ grants permission never gets caught up on reminders that were due
while permission was still denied. Since re-evaluating cheap, already-fetched data is
harmless, always re-checking undispatched candidates costs nothing and closes that gap.

**Alternatives considered**: Logging every qualifying candidate regardless of dispatch
outcome — rejected for the reason above. Two separate tables (one for recurring, one for
budget) — rejected as unnecessary; a single string key cleanly discriminates both cases and
keeps the repository surface smaller.

## 3. "App opened" hook point

**Decision**: Run `runNotificationCheck()` from the same place `BiometricEnrollmentPrompt` is
already triggered — `App.tsx`'s `Gate` component, once per successful unlock (its
`handleUnlock` callback), not via a new `visibilitychange`/focus listener.

**Rationale**: This app requires a PIN unlock on every fresh launch and re-locks after 5
minutes of inactivity (Constitution-mandated), so in practice "the user opened the app"
already coincides with "the user just unlocked it" for the overwhelming majority of real
usage — the same reasoning that already justifies triggering the one-time biometric-
enrollment prompt at this exact point. Building a separate foreground-detection mechanism
(no `visibilitychange` listener exists anywhere in this codebase yet) would add a second,
mostly-redundant trigger path for a case (switching back to an already-unlocked background
tab within the same 5-minute window) the spec's own Clarification already accepts as
best-effort ("on-open check," no guaranteed delivery while backgrounded).

**Alternatives considered**: Adding a `document.addEventListener('visibilitychange', …)`
listener — deferred as a possible future enhancement, not required to satisfy the spec's
Clarification or any Acceptance Scenario, all of which are phrased in terms of "opens the
app."

## 4. FR-007's in-app fallback needs no new UI

**Decision**: FR-007 ("still surface due/crossed events within the app's own UI") is already
satisfied by existing screens — `RecurringUpcomingPage` already lists every expected event
with a `pending`/`matched`/`missed` badge, and `BudgetsPage`'s `BudgetProgressCard` already
shows an actual-vs-planned progress bar (and an "Over budget" badge past 100%) for every
active budget. This feature adds no new "due items" or "budget status" view — only the
notification-preference settings screen and the one-time permission-request banner are new
UI.

**Rationale**: These screens were built for spec 001's User Stories 3 and 5/6 specifically
to answer "what's due/how am I doing," which is exactly what FR-007 requires be visible
independent of whether a system notification fired. Building a redundant "notifications
inbox" would duplicate data already shown elsewhere for no spec-required benefit.

**Alternatives considered**: A dedicated in-app notification center — rejected as
unnecessary scope; nothing in the spec's Acceptance Scenarios asks for one, and FR-007 only
requires the underlying data stay visible, which it already is.

## 5. Preferences as a new singleton entity

**Decision**: A new `NotificationPreference` singleton (`id: 'local-user'`), following the
`DebtPlannerPreference` pattern (spec 002) — its own small encrypted table, an in-memory
default returned by `get()` when nothing is stored, written only by `save()` — rather than
extending `UserProfile`.

**Rationale**: `UserProfile` is the app's unencrypted, pre-key-derivation auth/security
state (PIN verifier, lock timeout, biometric enrollment); notification preferences are
ordinary feature settings with no reason to live unencrypted or to be readable before the
user unlocks. Reusing the already-proven separate-singleton pattern keeps this consistent
with the rest of the codebase rather than growing `UserProfile`'s unrelated responsibilities.

**Alternatives considered**: Adding fields to `UserProfile` — rejected per above.

## 6. Notification content

**Decision**: Since `RecurringRule` has no descriptive name field (only `categoryId`,
`amount`, `frequency`, `dayOfPeriod`), a recurring reminder's notification title is built
from the category name exactly as `RecurringUpcomingPage` already displays it — e.g.
"Upcoming: Rent — due 2026-10-01". A budget notification title/body follows the feature
description's own example — e.g. "Dining budget — 82% used".

**Rationale**: Reuses the exact same category-name resolution already implemented and
displayed for the equivalent in-app view, keeping notification wording and in-app wording
consistent (a user seeing both shouldn't be confused by different labels for the same
thing).

## 7. No new dependencies

**Decision**: Uses only the native `Notification` API together with the Service Worker
`vite-plugin-pwa` already registers (no explicit `navigator.serviceWorker.register` call
needed — showing a notification from a foregrounded page uses `new Notification(...)`
directly, not a push subscription). No third-party push/notification library.

**Rationale**: Consistent with Constitution Principle V (free/OSS, no new dependency) and
Principle I (zero-server) — this feature never contacts any server, including for push
delivery, matching the spec's own Assumption that this is a "check on open," not a push
notification.
