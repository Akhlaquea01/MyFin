# Feature Specification: Savings Goals

**Feature Branch**: `003-savings-goals`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "Savings goals with visual progress — distinct from
sinking-fund budgets (FR-026): a goal has a target amount + target date and shows projected
completion based on current contribution rate."

## Clarifications

### Session 2026-09-06

- Q: How does money get counted "toward" a goal — does the user link the goal to a specific
  account, tag transactions as contributions, or manually log contribution amounts? →
  A: The user manually logs contribution amounts against the goal (no automatic linking to
  account balances or transaction tags in this version).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Create and Track a Savings Goal (Priority: P1)

A user creates a savings goal (e.g., "Emergency Fund", "Vacation") with a target amount and,
optionally, a target date, then logs contributions toward it over time and sees a progress
bar showing how close they are.

**Why this priority**: This is the entire feature — without creating a goal and recording
progress against it, there is nothing to show or project.

**Independent Test**: Create a goal with a target amount, log two contributions, and verify
the displayed progress (amount saved and percentage) matches the sum of the logged
contributions.

**Acceptance Scenarios**:

1. **Given** no goals exist, **When** the user creates a goal with a name and target amount,
   **Then** it appears with 0 progress toward the target.
2. **Given** an existing goal, **When** the user logs a contribution amount and date,
   **Then** the goal's saved amount and progress percentage update immediately.
3. **Given** a goal's saved amount reaches or exceeds its target amount, **When** the user
   views the goal, **Then** it is clearly marked as achieved.
4. **Given** an existing goal, **When** the user edits its target amount/date or deletes it,
   **Then** the change is reflected immediately and a deleted goal is recoverable from trash
   rather than immediately and permanently lost.

---

### User Story 2 - Projected Completion Date (Priority: P2)

A user with an active, unfinished goal sees a projected date by which they will reach their
target, based on their average contribution rate so far.

**Why this priority**: Turns a simple progress bar into a planning tool, but depends on
Story 1 already existing to have contribution history to project from.

**Independent Test**: Log contributions for a goal spaced roughly a month apart, then verify
the shown projected completion date is consistent with dividing the remaining amount by the
observed average monthly contribution.

**Acceptance Scenarios**:

1. **Given** a goal with at least two logged contributions on different dates, **When** the
   user views the goal, **Then** a projected completion date is shown based on the average
   contribution rate.
2. **Given** a goal with a user-set target date, **When** the projected completion date is
   later than the target date, **Then** the goal is visibly flagged as behind schedule.
3. **Given** a goal with fewer than two contributions, **When** the user views it, **Then**
   no projection is shown (insufficient data), rather than a misleading guess.

---

### User Story 3 - Goals Overview (Priority: P3)

A user views a summary of all their savings goals together — total saved across goals,
which are on track, and which are behind — from a single screen.

**Why this priority**: A convenience/overview layer once multiple goals exist; the feature
is already useful with just Story 1 and 2 for a single goal.

**Independent Test**: With three goals in different states (on track, behind, achieved),
open the overview and verify each is categorized correctly and the total saved figure
matches the sum of all goals' saved amounts.

**Acceptance Scenarios**:

1. **Given** multiple goals exist, **When** the user opens the goals overview, **Then** each
   goal's name, progress, and on-track/behind/achieved status are shown together.

---

### Edge Cases

- What happens when a goal has no target date? Progress and projected completion are still
  shown, but "on track / behind schedule" status (which requires a target date to compare
  against) is not displayed.
- What happens when a contribution is logged that is larger than the remaining amount needed
  (overshoot)? The goal is marked achieved and the excess is simply reflected in the total
  saved amount, not silently capped or rejected.
- What happens when a contribution is logged with a future date? It should be rejected or
  flagged, since a "contribution" represents money already set aside.
- What happens when a user deletes a goal that has logged contributions? The goal and its
  contribution history move to trash together and can be restored together, consistent with
  the app's soft-delete model.
- What happens when the projected completion date calculation would require dividing by a
  zero or negative average contribution rate (e.g., contributions have stalled or gone
  backward via a correction)? No projection is shown rather than an infinite or nonsensical
  date.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Users MUST be able to create a savings goal with a name, a target amount, and
  an optional target date.
- **FR-002**: Users MUST be able to log a contribution (amount and date) against a goal at
  any time.
- **FR-003**: System MUST maintain each goal's total saved amount as the sum of its logged
  contributions and display progress as an amount and a percentage of the target.
- **FR-004**: System MUST mark a goal as achieved once its saved amount reaches or exceeds
  its target amount.
- **FR-005**: System MUST compute and display a projected completion date for an unachieved
  goal once it has at least two logged contributions, based on the average contribution rate
  observed so far.
- **FR-006**: When a goal has a target date and its projected completion date is later than
  the target date, system MUST visibly flag the goal as behind schedule.
- **FR-007**: Users MUST be able to edit a goal's name, target amount, and target date, and
  to soft-delete a goal (recoverable) rather than only permanently deleting it.
- **FR-008**: Users MUST be able to view a combined overview of all goals showing progress
  and on-track/behind/achieved status for each.
- **FR-009**: System MUST reject or flag a contribution dated in the future.

### Key Entities

- **Savings Goal**: A target amount, optional target date, name, and current status
  (in-progress / achieved); can be soft-deleted.
- **Goal Contribution**: A single logged amount and date applied toward a specific goal's
  progress.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A goal's displayed saved amount and progress percentage always reconcile
  exactly with the sum of its logged, non-deleted contributions.
- **SC-002**: A user can create a new goal and log its first contribution in under 20
  seconds.
- **SC-003**: Projected completion dates are only shown when at least two contributions
  exist, with zero instances of a projection shown from a single data point.
- **SC-004**: A user can tell, within 5 seconds of opening the goals overview, which of
  their goals are behind schedule.

## Assumptions

- Contributions are logged manually by the user rather than automatically derived from
  account balances or tagged transactions; automatic linking is out of scope for this
  version and could be a future enhancement.
- A goal is a standalone entity, separate from the existing sinking-fund budget mechanism
  (FR-026 in the core spec), since a goal is not tied to a recurring category-spending period.
- Single currency, matching the rest of the application.
