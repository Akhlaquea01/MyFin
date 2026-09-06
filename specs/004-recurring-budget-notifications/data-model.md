# Phase 1 Data Model: Recurring & Budget Notifications

Conventions follow the core app's data model: UUID primary keys, integers for every
monetary field, `createdAt`/`updatedAt` timestamps, and AES-GCM-encrypted-at-rest storage
for the plaintext shape described below (this feature introduces no unencrypted table).

## NotificationPreference (new, singleton)

Remembers whether the feature is on and the user's configured thresholds (Story 3).

| Field                     | Type                   | Notes                                                                                                                                                                                              |
| ------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                        | literal `"local-user"` | Singleton PK, mirrors `DebtPlannerPreference`'s pattern                                                                                                                                            |
| enabled                   | boolean                | Defaults to `true` — an explicit OFF switch (FR-005), not a separate opt-in; the real gate on whether a notification can fire is the browser's own `Notification.permission`, requested per FR-001 |
| reminderLeadDays          | integer                | Days ahead of an expected event's due date to alert (FR-006); defaults to `1`                                                                                                                      |
| budgetThresholdPercent    | integer                | % of a budget's planned amount that triggers an alert (FR-006); defaults to `80`                                                                                                                   |
| permissionPromptDismissed | boolean                | Suppresses the one-time enable banner once the user has responded to it                                                                                                                            |
| createdAt                 | timestamp              |                                                                                                                                                                                                    |
| updatedAt                 | timestamp              |                                                                                                                                                                                                    |

## NotifiedItem (new)

The "Notification Log" from the spec's Key Entities — internal bookkeeping only, never
rendered to the user. Prevents re-showing a system notification for the same occurrence
(FR-004).

| Field      | Type      | Notes                                                                                                           |
| ---------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| id         | UUID      | PK                                                                                                              |
| key        | string    | Indexed. `recurring:{expectedEventId}` or `budget:{budgetId}:{periodStart}:{thresholdPercent}` (research.md §2) |
| notifiedAt | timestamp | Written only after a real `Notification` was dispatched (research.md §2)                                        |

**Validation**: A row is written at most once per distinct `key` — `runNotificationCheck()`
checks for an existing row with that `key` before dispatching, and only inserts after a
successful dispatch.

## NotificationCandidate (derived, not persisted)

The shape the pure engine functions (`findDueRecurringEvents`, `findCrossedBudgetThresholds`)
produce; consumed by the orchestrator and by unit tests.

| Field | Type                        | Notes                               |
| ----- | --------------------------- | ----------------------------------- |
| kind  | enum: `recurring`, `budget` |                                     |
| key   | string                      | The same dedupe key described above |
| title | string                      | Notification title (research.md §6) |
| body  | string                      | Notification body                   |

## Entity Relationship Summary

```
RecurringRule 1---* ExpectedEvent   (existing, spec 001)          --> findDueRecurringEvents --> NotificationCandidate
Budget 1---* BudgetItem            (existing, spec 001)          --> findCrossedBudgetThresholds --> NotificationCandidate
NotificationCandidate ---> (dedupe check against) NotifiedItem ---> (on dispatch) writes NotifiedItem
NotificationPreference (singleton) ---> governs whether/how the check and dispatch run
```
