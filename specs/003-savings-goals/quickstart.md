# Quickstart: Savings Goals

Validation scenarios proving the feature works end-to-end, once implemented per
[plan.md](plan.md), [data-model.md](data-model.md), and
[contracts/goal-progress-engine.md](contracts/goal-progress-engine.md).

## Prerequisites

- App running locally (`npm run dev`) with onboarding completed.

## Scenario 1 — Create a goal, log contributions, reach it (User Story 1)

1. Create a goal "Emergency Fund" with target amount ₹10,000 and no target date.
2. **Expect**: it appears with ₹0 saved, 0% progress, not achieved.
3. Log a contribution of ₹3,000 (today), then ₹2,000 (today).
4. **Expect**: saved amount updates to ₹5,000, progress shows 50%.
5. Log a third contribution of ₹6,000 (overshoot).
6. **Expect**: saved amount is ₹11,000 (110%), the goal is clearly marked achieved — the
   excess is not capped or rejected.

## Scenario 2 — Projected completion date and behind-schedule flag (User Story 2)

1. Create a goal "Vacation" with target amount ₹12,000 and a target date 3 months from
   today.
2. Log a contribution of ₹1,000 dated 2 months ago, then a contribution of ₹1,000 dated
   today.
3. **Expect**: a projected completion date appears, computed as
   `today + ceil((12000 − 2000) / (2000 / 2)) = today + 10 months` (per
   [contracts/goal-progress-engine.md](contracts/goal-progress-engine.md)).
4. **Expect**: since the 10-month projection is later than the 3-month target date, the goal
   is visibly flagged behind schedule.
5. Log one more contribution of ₹4,000 dated today (saved is now ₹6,000 over the same
   2-month span → monthly rate rises to `6000 / 2 = 3,000/mo`, so `remaining = 6000` and
   `monthsToGo = ceil(6000 / 3000) = 2`).
6. **Expect**: the projected completion date recalculates to `today + 2 months`, which now
   falls before the 3-month target date, so the behind-schedule flag clears.

## Scenario 3 — Goals overview across mixed states (User Story 3)

1. With "Emergency Fund" (achieved, ₹11,000 saved, from Scenario 1) and "Vacation" (now
   on-track, ₹6,000 saved, from Scenario 2 step 5) already created, create a third goal "New
   Laptop" (target ₹8,000, no target date) and log a single ₹500 contribution against it.
2. Open the goals overview.
3. **Expect**: all three goals are listed with their progress; "Emergency Fund" shows
   achieved, "Vacation" shows on-track, "New Laptop" shows insufficient-data (only one
   contribution logged — no projection yet). The total saved figure shown equals the sum of
   all three goals' saved amounts (₹11,000 + ₹6,000 + ₹500 = ₹17,500).

## Scenario 4 — Future-dated contribution is rejected (Edge Case / FR-009)

1. On any goal, attempt to log a contribution dated tomorrow.
2. **Expect**: the app rejects or flags the entry rather than accepting it silently.

## Scenario 5 — A stalled/negative rate shows no projection, not a bad guess (Edge Case)

1. On a goal with an existing projection (e.g. "Vacation" from Scenario 2), log a correction
   contribution large enough in the negative direction that the goal's overall average
   monthly rate becomes zero or negative.
2. **Expect**: the projected completion date disappears (shown as insufficient data) rather
   than displaying a nonsensical or infinite date.

## Scenario 6 — Deleting and restoring a goal keeps its contributions (Edge Case)

1. Delete "New Laptop" (which has a logged contribution).
2. **Expect**: it disappears from the active goals list and overview total.
3. Restore it from Trash.
4. **Expect**: it reappears with its ₹500 contribution and progress intact, exactly as
   before deletion.

## Automated coverage

These scenarios correspond to:

- `tests/unit/goalProgressEngine.test.ts` — Scenarios 1, 2, 3, 5 (pure engine logic: saved
  amount, achieved flag, projection formula, status classification).
- `tests/integration/savingsGoalRepositories.test.ts` — contribution validation (Scenario 4),
  and the soft-delete/restore behavior in Scenario 6.
- `tests/e2e/savingsGoals.spec.ts` — Scenarios 1-3 and 6 end-to-end through the UI.
