# Phase 0 Research: Debt Payoff Planner

## 1. Amortization / payoff projection model

**Decision**: Simple monthly-step simulation. For each liability, each simulated month:
apply that month's interest (annual rate ÷ 12, applied to the current outstanding balance),
then apply that month's payment (minimum, or minimum + reallocated extra under the active
strategy's priority order). Repeat until all balances reach zero, capping the simulation at
a sane horizon (e.g., 600 months / 50 years) to guard against a non-converging input
(payment less than accruing interest).

**Rationale**: This matches how real lenders compute monthly interest and is simple enough
to unit-test against hand-built amortization tables (Constitution Principle IV). A
closed-form amortization formula exists for a single fixed-payment loan, but the "waterfall"
behavior (a paid-off debt's minimum payment rolling into the next debt) makes the multi-debt
system path-dependent, so month-by-month simulation is the only approach that stays correct
once debts start finishing early.

**Alternatives considered**:

- Closed-form amortization formula per debt, summed independently — rejected because it
  cannot express the waterfall reallocation between debts (FR-004), which is the entire
  point of comparing avalanche vs. snowball.
- Daily-interest simulation — rejected as unnecessary precision for a planning tool; monthly
  step matches how the spec's edge cases and success criteria ("within one billing cycle")
  are already framed.

## 2. Representing interest rate without floating point

**Decision**: Store `interestRate` as an integer in basis points (1/100 of a percent), e.g.
`1850` = 18.50% APR — the same "smallest unit as integer" discipline the Constitution
already mandates for money (Principle VI), applied here to a rate rather than an amount.
Monthly interest accrual is computed as `Math.round(balance * rateBasisPoints / 10000 / 12)`
at each simulated step, so rounding happens once per step against an integer balance, never
against an accumulated float.

**Rationale**: Keeps the entire engine free of floating-point drift, consistent with the
project's existing monetary-integer discipline, and keeps interest computation trivially
testable (integer in, integer out, exact expected value per step).

**Alternatives considered**: Storing rate as a decimal/float (e.g. `18.5`) — rejected; even
though a rate isn't itself money, feeding a float into a balance calculation reintroduces
the exact class of rounding bug Principle VI exists to prevent.

## 3. Relationship between the existing `emiAmount` field and the new `minimumPayment`

**Decision**: Add a new `minimumPayment` field to `Liability`, used only by the payoff
planner. When a `loan`-type liability already has `emiAmount` set, the planner pre-fills
`minimumPayment` from it as a default that the user can still override; `credit_card`-type
liabilities (which have no EMI concept) always require `minimumPayment` to be entered
directly.

**Rationale**: `emiAmount`/`emiDueDay` exist to drive the _existing_ Liabilities feature's
recurring-EMI tracking and are a different concern from "the minimum a payoff plan must
allocate before applying extra payment." Reusing `emiAmount` outright would couple the two
features and break if a user's actual minimum diverges from their scheduled EMI (e.g., they
consistently pay above EMI). A separate, pre-filled field keeps both features independently
correct while minimizing duplicate data entry.

**Alternatives considered**: Reusing `emiAmount` directly as the planner's minimum payment
— rejected per above. Requiring a wholly separate manual entry with no pre-fill — rejected
as unnecessary friction when the data already exists for loans.

## 4. Where this fits in the layered architecture

**Decision**: New `src/domain/debtPlanner/` engine (pure TypeScript, no framework
dependency), consuming `Liability` records via the existing liability repository interface
(read-only) and a new small `DebtPlannerPreferenceRepository` (see data-model.md) for the
user's last-used strategy/extra-payment amount. No new Dexie tables beyond the
`Liability` schema extension and one new small preference table.

**Rationale**: Matches Constitution Principle III exactly as the core app already does —
domain logic depends only on repository interfaces, is unit-testable in isolation, and the
UI layer (a new page/panel) only calls the engine and repositories, never Dexie directly.

**Alternatives considered**: Embedding the calculation directly in a UI component —
rejected, violates Principle III and Principle IV's test-first requirement for
money-affecting logic.

## 5. New dependencies

**Decision**: None. The engine is pure arithmetic over existing/extended data structures;
no charting, date-math, or amortization library is needed beyond what the core app already
uses (native `Date`/integer arithmetic, Vitest for tests).

**Rationale**: Consistent with Constitution Principle V (free/OSS only, minimal footprint)
and the project's existing preference for hand-written, testable domain logic over pulling
in a financial-math dependency for a single-purpose calculation.
