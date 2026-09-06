# Contract: Notification Engine

This app has no external API; its "contracts" are the internal interfaces between the
domain engine (`src/domain/notifications/`), its orchestrator, and its callers, per
Constitution Principle III's one-way dependency rule.

## Pure functions (`src/domain/notifications/notificationEngine.ts`)

### `findDueRecurringEvents(events, leadDays, asOfDate): NotificationCandidate[]`

```ts
interface DueEventInput {
	id: string;
	expectedDate: string; // ISO date
	status: 'pending' | 'matched' | 'missed';
	categoryName: string; // already resolved by the caller
}
```

Returns one `{ kind: 'recurring', key: 'recurring:{id}', title, body }` candidate for every
input whose `status === 'pending'` and `expectedDate <= addDays(asOfDate, leadDays)`
(inclusive; no lower bound — an overdue-but-still-`pending` event still qualifies, though in
practice the orchestrator runs `markMissedPastDue()` first so this case is rare). Never
mutates its input; performs no I/O.

### `findCrossedBudgetThresholds(items, thresholdPercent): NotificationCandidate[]`

```ts
interface BudgetThresholdInput {
	budgetId: string;
	periodStart: string; // ISO date
	plannedAmount: number; // integer, smallest currency unit
	actualAmount: number; // integer, smallest currency unit
	categoryName: string; // already resolved by the caller
}
```

Returns one `{ kind: 'budget', key: 'budget:{budgetId}:{periodStart}:{thresholdPercent}',
title, body }` candidate for every input with `plannedAmount > 0` and `(actualAmount /
plannedAmount) * 100 >= thresholdPercent`. Never mutates its input; performs no I/O.

## Orchestrator (`src/domain/notifications/runNotificationCheck.ts`)

### `runNotificationCheck(key: CryptoKey, asOfDate: Date = new Date()): Promise<{ dispatched: NotificationCandidate[] }>`

**Behavior**:

1. Load `NotificationPreference` via `NotificationPreferenceRepository.get()`. If
   `!enabled`, return `{ dispatched: [] }` immediately — no reads, no dispatch (FR-005).
2. Load active `RecurringRule`s, run the existing `generateExpectedEvents` /
   `markMissedPastDue` (spec 001's `recurringEngine.ts`) exactly as
   `RecurringUpcomingPage` already does, then read pending events and resolve each one's
   category name. Call `findDueRecurringEvents(..., preference.reminderLeadDays, asOfDate)`.
3. Load all `Budget`s, call the existing `ensureCurrentBudgetItem` for each (spec 001's
   `budgetEngine.ts`) to get each one's current-period `BudgetItem`, resolve each budget's
   category name. Call `findCrossedBudgetThresholds(..., preference.budgetThresholdPercent)`.
4. For each candidate from steps 2-3, check `NotifiedItemRepository.exists(key,
candidate.key)`; skip already-logged candidates.
5. For each remaining candidate: if `typeof Notification !== 'undefined' &&
Notification.permission === 'granted'`, call `new Notification(candidate.title, { body:
candidate.body, tag: candidate.key })` and, only on success, call
   `NotifiedItemRepository.create(key, { key: candidate.key })`. If permission is not
   granted, or the `Notification` constructor throws, skip both the dispatch and the log
   write for that candidate (research.md §2) — it remains eligible on the next check.
6. Return `{ dispatched: <candidates that were actually written to the log> }`.

**Error cases**: Never throws for a missing/denied `Notification` API — checks
`typeof Notification !== 'undefined'` first (some browsers/contexts lack it entirely) and
treats that identically to "permission not granted."

## Repository interfaces consumed

- `NotificationPreferenceRepository`:
  - `get(key): Promise<NotificationPreference>` — decrypted singleton, or an in-memory
    default (`enabled: true, reminderLeadDays: 1, budgetThresholdPercent: 80,
permissionPromptDismissed: false`) when none is stored yet. `enabled: true` by default
    is an explicit OFF switch (FR-005/Story 3), not a required opt-in step — the actual gate
    on dispatch is the browser's own `Notification.permission` (step 5 below), requested via
    the one-time banner per FR-001. This keeps Story 1 reachable without a prior settings
    visit, matching its Independent Test.
  - `save(key, pref): Promise<NotificationPreference>` — upserts the singleton.
- `NotifiedItemRepository`:
  - `exists(key, dedupeKey): Promise<boolean>`
  - `create(key, input: { key: string }): Promise<NotifiedItem>`
