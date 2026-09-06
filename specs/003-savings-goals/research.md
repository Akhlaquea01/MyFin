# Phase 0 Research: Savings Goals

## 1. Projected completion date formula

**Decision**: For a goal with at least two logged contributions, compute a whole-month span
between the date of its first and most recent (by date) contribution using the same
whole-month arithmetic already used by the debt payoff planner (spec 002). If that span is
zero whole months (e.g., both contributions logged in the same calendar month), treat the
goal the same as "fewer than two contributions" — insufficient data, no projection shown.
Otherwise: `monthlyRate = totalContributed / monthSpan`; if `monthlyRate <= 0`, show no
projection (Edge Case: stalled/negative rate). Otherwise `remaining = max(0, target -
totalContributed)`, `monthsToGo = ceil(remaining / monthlyRate)`, and
`projectedCompletionDate = addMonths(today, monthsToGo)` — projected forward from _today_
using the historically observed rate, not from the last contribution date, since the
question a user is asking is "from now, when will I get there."

**Rationale**: Matches the spec's own Independent Test for User Story 2 literally ("dividing
the remaining amount by the observed average monthly contribution"), and reuses a
month-granularity convention this codebase has already established (spec 002's
`generatePlan.ts`) rather than introducing day-level precision the feature doesn't need.
Treating a zero-month span as insufficient data (rather than dividing by a near-zero
duration and producing a wild rate) directly prevents the "misleading guess" the spec's
Edge Cases and SC-003 explicitly warn against.

**Alternatives considered**: Projecting forward from the last contribution's date instead of
today — rejected because it can make the projection appear stale/in-the-past for a goal the
user hasn't contributed to recently, which is a worse user experience than an
always-forward-looking estimate. Day-level rate precision — rejected as unnecessary
precision matching neither the spec's own framing nor this codebase's established
month-granularity pattern for this class of projection.

## 2. Reusing month-arithmetic across features

**Decision**: Extract the existing private `addMonthsISO`/whole-month-span helpers out of
`src/domain/debtPlanner/generatePlan.ts` into a small shared module,
`src/domain/shared/dateMath.ts`, and have both `debtPlanner` and the new `savingsGoals`
engine import from it.

**Rationale**: Both features need identical "first-of-month ISO date, N months from a given
date" and "whole months between two dates" logic; duplicating it a second time would create
two implementations that could silently drift. This is a small, low-risk refactor of
already-tested code (spec 002's existing unit tests continue to exercise it unchanged) and
keeps both engines pure/framework-agnostic per Constitution Principle III.

**Alternatives considered**: Duplicating the helper directly in the new engine — rejected as
avoidable duplication for logic this simple to share. Pulling in a date library (date-fns,
dayjs) — rejected per Constitution Principle V/the project's existing preference for
hand-written date math over a new dependency for a few lines of logic.

## 3. Contribution correction model

**Decision**: A `GoalContribution` amount may be any non-zero integer, including negative,
so a user can correct a mistaken entry by logging an offsetting contribution rather than
needing to edit or delete history. Contributions themselves are not independently
soft-deleted (no `deletedAt` on `GoalContribution`) — deleting one is a direct removal,
mirroring existing "detail record" entities in this codebase that also lack independent
soft-delete (e.g., `TransactionSplit`, `InvestmentValuation`).

**Rationale**: The spec's Edge Cases explicitly anticipate "contributions have stalled or
gone backward via a correction," implying corrections are a supported input, not an error
state. Matching the existing precedent of undecorated detail records keeps the data model
consistent with the rest of the app rather than introducing a new soft-delete pattern for a
child record whose parent (`SavingsGoal`) already has one.

**Alternatives considered**: Requiring contributions to always be positive and only allowing
correction via delete — rejected; deleting historical records erases the audit trail a
"corrected" entry preserves, and the spec's own wording ("gone backward via a correction")
implies the correction itself is data, not a deletion.

## 4. Goal soft-delete/restore and its effect on contributions

**Decision**: Soft-deleting a `SavingsGoal` sets its own `deletedAt` only; its
`GoalContribution` rows are left completely untouched. Since contributions are only ever
queried scoped to their (non-deleted) parent goal, they become invisible automatically once
the goal is trashed and immediately visible again once restored — no cascading write is
needed for the soft-delete/restore path itself. A permanent purge of a goal (following the
existing app-wide "explicit separate action" pattern, Constitution Principle VI) hard-deletes
its contributions in the same operation.

**Rationale**: Achieves the spec's Edge Case ("the goal and its contribution history move to
trash together and can be restored together") with zero extra state to keep in sync, since
visibility is derived from the parent relationship rather than duplicated onto each child
row.

**Alternatives considered**: Mirroring `deletedAt` onto every contribution when its goal is
deleted — rejected as redundant writes for a state already implied by the parent, and a
source of drift if the two ever became inconsistent.

## 5. Goal status classification (for the Story 3 overview)

**Decision**: A goal's overview status is one of four values, computed by the domain engine,
never stored: `achieved` (saved ≥ target), `insufficient-data` (unachieved, fewer than two
contributions or a zero-month contribution span), `behind` (unachieved, has both a
projection and a target date, and the projection is later than the target date), `on-track`
(everything else — unachieved but either no target date is set, or the projection meets it).

**Rationale**: FR-006 only defines "behind schedule" for a goal that already has both a
projection and a target date; Story 3's overview needs a status for every goal regardless,
so `insufficient-data` and `on-track` fill the two gaps FR-005/FR-006 leave open, staying
strictly derived (no new persisted field, consistent with how this app already treats budget
adherence and net worth as always-recomputed).

**Alternatives considered**: Persisting a `status` field on `SavingsGoal` — rejected;
storing a derived value invites it to drift from the underlying contributions, which is
exactly what Constitution Principle VI's data-integrity concerns exist to prevent elsewhere
in this app.

## 6. New dependencies

**Decision**: None. Pure arithmetic over existing/new local entities; no charting or
date-math library needed beyond the shared helper in decision 2.
