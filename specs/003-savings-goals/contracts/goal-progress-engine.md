# Contract: Goal Progress Engine

This app has no external API; its "contracts" are the internal interfaces between the
domain engine (`src/domain/savingsGoals/`) and its callers (the UI layer, and unit tests),
per Constitution Principle III's one-way dependency rule.

## `computeGoalProgress(input): GoalProgress`

**Input**:

```ts
interface ComputeGoalProgressInput {
	goal: {
		id: string;
		targetAmount: number; // integer, smallest currency unit, > 0
		targetDate: string | null; // ISO date
	};
	contributions: { amount: number; date: string }[]; // already scoped to this goal
	asOfDate: Date; // "today"; a parameter for testability
}
```

**Behavior**:

1. `savedAmount` = sum of `contributions[].amount` (may include negative correction entries,
   research.md §3).
2. `achieved` = `savedAmount >= goal.targetAmount`. When `achieved`, `projectedCompletionDate`
   is always `null` and `status` is always `"achieved"` — no projection math runs.
3. When not achieved:
   - If fewer than 2 contributions exist, or the whole-month span (per the shared
     `src/domain/shared/dateMath.ts` helper) between the earliest and latest contribution
     date is 0, `projectedCompletionDate` is `null` and `status` is `"insufficient-data"`.
   - Otherwise compute `monthlyRate = savedAmount / monthSpan`. If `monthlyRate <= 0`,
     `projectedCompletionDate` is `null` and `status` is `"insufficient-data"` (a
     stalled/negative rate is exactly as uninformative as too little data — research.md §1).
   - Otherwise `projectedCompletionDate = addMonths(asOfDate, ceil((targetAmount -
savedAmount) / monthlyRate))`.
4. When a `projectedCompletionDate` was computed and `goal.targetDate` is set: `status` is
   `"behind"` if `projectedCompletionDate > goal.targetDate`, else `"on-track"`.
5. When a `projectedCompletionDate` was computed and `goal.targetDate` is `null`: `status` is
   `"on-track"` (no target to be behind against).
6. MUST NOT mutate its input or perform any I/O — this function is pure.

**Output**: A `GoalProgress` per data-model.md.

**Error cases**: None — every input combination above maps to a defined output; there is no
invalid input shape this function rejects (validation of contribution date/amount happens at
the repository/UI boundary before a contribution is ever persisted, per FR-009).

## Repository interfaces consumed (read-only by the engine; read-write by the UI)

- `SavingsGoalRepository`:
  - `create(key, input: { name; targetAmount; targetDate }): SavingsGoal`
  - `update(key, id, changes: Partial<{ name; targetAmount; targetDate }>): SavingsGoal`
  - `softDelete(key, id): void`
  - `restore(key, id): void`
  - `list(key): SavingsGoal[]` — non-deleted only
- `GoalContributionRepository`:
  - `create(key, input: { goalId; amount; date }): GoalContribution` — MUST reject (throw)
    when `date` is later than the current date (FR-009) or `amount` is `0`.
  - `remove(key, id): void` — direct removal (research.md §3); no soft-delete/restore.
  - `listForGoal(key, goalId): GoalContribution[]`
