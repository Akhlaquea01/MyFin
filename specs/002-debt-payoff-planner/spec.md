# Feature Specification: Debt Payoff Planner

**Feature Branch**: `002-debt-payoff-planner`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "Debt payoff planner — snowball/avalanche calculator built on
the existing Liability entity, showing payoff order and projected payoff dates."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Generate a Payoff Plan (Priority: P1)

A user with one or more liabilities (loans, credit cards) opens the debt payoff planner,
picks a payoff strategy (avalanche or snowball), and sees the order their debts will be
paid off in along with a projected payoff date for each and for the plan overall.

**Why this priority**: This is the core value of the feature — without a computed order and
timeline, there is no "planner," just a list of debts the user already has.

**Independent Test**: With at least two liabilities that have an interest rate and a minimum
payment recorded, open the planner, select a strategy, and verify the debts are ordered
correctly (highest interest rate first for avalanche, smallest balance first for snowball)
with plausible payoff dates.

**Acceptance Scenarios**:

1. **Given** two or more liabilities with interest rate and minimum payment set, **When**
   the user selects the "avalanche" strategy, **Then** debts are ordered from highest to
   lowest interest rate and each shows a projected payoff date.
2. **Given** the same liabilities, **When** the user selects the "snowball" strategy,
   **Then** debts are ordered from smallest to largest outstanding balance and each shows a
   projected payoff date.
3. **Given** a generated plan, **When** the user views it, **Then** the plan also shows the
   overall projected debt-free date and total interest expected to be paid.

---

### User Story 2 - Apply Extra Monthly Payment (Priority: P2)

A user specifies an additional amount they can pay each month beyond the required minimums,
and the plan recalculates to show how much sooner they become debt-free and how much
interest they save.

**Why this priority**: Extra payments are the main lever a user has to accelerate payoff;
without this, the planner is a static readout rather than a planning tool.

**Independent Test**: Enter an extra monthly payment amount on an existing plan and verify
the projected payoff date moves earlier and total interest decreases versus the
minimum-payments-only plan.

**Acceptance Scenarios**:

1. **Given** a generated plan, **When** the user enters an extra monthly payment amount,
   **Then** the plan recalculates, applying the full extra amount to the current
   highest-priority debt under the chosen strategy.
2. **Given** a debt in the plan becomes fully paid off, **When** the plan recalculates for
   the following month, **Then** that debt's minimum payment amount is added to the extra
   payment pool and redirected to the next debt in priority order ("waterfall").
3. **Given** an extra payment amount, **When** the user changes it, **Then** the plan updates
   without requiring the user to re-enter any liability data.

---

### User Story 3 - Compare Strategies (Priority: P3)

A user views a side-by-side comparison of the avalanche and snowball strategies for their
current debts and extra payment amount, to decide which approach to follow.

**Why this priority**: Comparison is a convenience on top of Story 1 — a user can still get
value from generating one plan at a time, but seeing both side by side is what helps them
choose.

**Independent Test**: With an extra payment amount set, open the comparison view and verify
the months-to-debt-free and total-interest-paid figures shown for each strategy match what
generating each plan individually would show.

**Acceptance Scenarios**:

1. **Given** at least two liabilities and an extra payment amount, **When** the user opens
   the comparison view, **Then** total months to debt-free and total interest paid are shown
   for both strategies side by side.

---

### Edge Cases

- What happens when a liability has no interest rate or no minimum payment recorded? The
  planner must prompt the user to supply the missing value before including that liability
  in a plan, rather than guessing or silently excluding it.
- What happens when the extra payment amount is too small to matter, or zero? The plan must
  still compute correctly using only minimum payments.
- What happens when the sum of all minimum payments exceeds what the user says they can
  afford? The planner should surface this as a warning rather than silently producing an
  infeasible or negative-progress schedule.
- What happens when a liability's outstanding balance is edited (in the Liabilities feature)
  after a plan was generated? The plan must be recalculated from current data the next time
  it is viewed, never shown stale.
- What happens when there is only one liability, or none at all? With one liability, "order"
  is trivial but a payoff date must still be shown; with none, the planner should explain
  there is nothing to plan and link to adding a liability.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Users MUST be able to choose between an "avalanche" (highest interest rate
  first) and "snowball" (smallest outstanding balance first) payoff strategy.
- **FR-002**: System MUST compute a projected month-by-month payoff schedule for each active
  liability, using its outstanding balance, interest rate, and minimum payment.
- **FR-003**: Users MUST be able to specify an additional monthly payment amount beyond the
  sum of minimum payments.
- **FR-004**: System MUST apply the extra payment amount to the single highest-priority debt
  under the chosen strategy each month, and MUST roll a paid-off debt's minimum payment into
  the extra-payment pool for the remaining debts ("waterfall") for subsequent months.
- **FR-005**: System MUST display, for the overall plan, the projected date all debts are
  paid off and the total interest expected to be paid from today forward.
- **FR-006**: System MUST allow the user to view an avalanche-vs-snowball comparison showing
  months-to-debt-free and total interest paid for both strategies at the same extra payment
  amount.
- **FR-007**: The planner MUST treat its output as read-only and derived — generating or
  recalculating a plan MUST NOT alter any stored Liability record.
- **FR-008**: If a liability included in the plan is missing an interest rate or minimum
  payment, system MUST prompt the user to enter the missing value(s) before that liability
  can be included in a computed plan.
- **FR-009**: System MUST recalculate the plan whenever underlying liability balances, the
  chosen strategy, or the extra payment amount change, rather than caching a stale result.
- **FR-010**: System MUST warn the user, rather than silently computing an incorrect result,
  when combined minimum payments cannot be satisfied by the amounts the user has indicated
  are available.

### Key Entities

- **Liability** (existing entity, extended): gains an interest rate (annual percentage) and
  requires a minimum payment amount to be eligible for inclusion in a payoff plan.
- **Debt Payoff Plan**: A derived, on-demand calculation (strategy choice, extra payment
  amount, and the resulting ordered schedule); not an independent source of truth and always
  recomputed from current Liability data rather than persisted as a separate ledger.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: For a given set of liabilities, interest rates, minimum payments, and extra
  payment amount, the projected payoff date for each debt and for the plan overall matches a
  manual amortization calculation to within one billing cycle.
- **SC-002**: A user can generate a plan and view both strategies compared in under 30
  seconds from opening the planner.
- **SC-003**: 100% of the extra payment amount is allocated to the correct debt at each step
  of the plan, verified against hand calculation on a sample data set.
- **SC-004**: Changing the extra payment amount updates the visible plan in under 1 second.

## Assumptions

- Interest accrues monthly (simple monthly compounding) for projection purposes; this is a
  planning estimate, not a legally binding amortization schedule from a lender.
- The Liability entity needs new `interestRate` (annual %) and a required-for-planning
  `minimumPayment` field; liabilities without them are excluded from a plan until supplied.
- The planner is a read-only analysis view; it does not create transactions or modify
  liability records, consistent with the app's zero-server, local-only architecture.
- Single currency, matching the rest of the application (see [multi-currency-support](../008-multi-currency-support/spec.md) if that changes).
