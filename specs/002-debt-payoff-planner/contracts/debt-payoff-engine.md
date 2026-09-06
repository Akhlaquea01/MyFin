# Contract: Debt Payoff Engine

This app has no external API; its "contracts" are the internal interfaces between the
domain engine (`src/domain/debtPlanner/`) and its callers (the UI layer, and unit tests),
per Constitution Principle III's one-way dependency rule.

## `generateDebtPayoffPlan(input): DebtPayoffPlan`

**Input**:

```ts
interface GeneratePlanInput {
	liabilities: EligibleLiability[]; // already filtered to non-deleted liabilities
	strategy: 'avalanche' | 'snowball';
	extraMonthlyPayment: number; // integer, smallest currency unit, >= 0
	asOfDate: Date; // simulation start date (defaults to "today" in production use)
}

interface EligibleLiability {
	id: string;
	outstandingBalance: number; // integer, smallest currency unit
	interestRate: number; // integer basis points
	minimumPayment: number; // integer, smallest currency unit
}
```

**Behavior**:

1. Liabilities missing `interestRate` or `minimumPayment` MUST be excluded by the caller
   before invoking this function (the engine assumes a fully-eligible input list); the
   caller is responsible for producing `excludedLiabilityIds` (FR-008) from the full
   liability set before calling.
2. Order `liabilities` by the chosen `strategy`: `avalanche` = descending `interestRate`
   (ties broken by descending `outstandingBalance`); `snowball` = ascending
   `outstandingBalance` (ties broken by descending `interestRate`).
3. Simulate month-by-month per research.md §1: each month, accrue interest on every
   liability, apply each liability's `minimumPayment`, then apply the full
   `extraMonthlyPayment` pool to the single highest-priority liability with a remaining
   balance. When a liability's balance reaches zero, its `minimumPayment` is added to the
   extra-payment pool for all subsequent months (the "waterfall").
4. Stop simulating a liability once its balance reaches exactly zero (never negative); stop
   the overall simulation once all liabilities reach zero, or at a 600-month safety cap
   (flag the plan as non-converging if the cap is hit — see Error Cases).
5. MUST NOT mutate any input liability object or call any repository write method — this
   function is pure (Spec FR-007).

**Output**: A `DebtPayoffPlan` per data-model.md, with one `DebtPayoffPlanEntry` per input
liability, in priority order.

**Error cases**:

- Empty `liabilities` input → returns a plan with empty `entries`, `payoffDate: null`,
  `totalInterest: 0` (caller renders the "nothing to plan" empty state, per spec Edge
  Cases).
- Sum of `minimumPayment` across all liabilities exceeds what the simulation can service
  (i.e., a liability's `minimumPayment` is less than its own accruing monthly interest, so
  its balance never decreases even before considering other debts) → the engine MUST return
  a plan flagged `nonConverging: true` for the affected `DebtPayoffPlanEntry` instead of
  simulating indefinitely or throwing (spec Edge Case: "warn ... rather than silently
  computing an incorrect result", FR-010). The UI surfaces this as the warning required by
  FR-010.

## `compareStrategies(input): { avalanche: DebtPayoffPlan; snowball: DebtPayoffPlan }`

Thin wrapper that calls `generateDebtPayoffPlan` twice (once per strategy) with the same
liabilities and `extraMonthlyPayment`, for Story 3's side-by-side comparison (FR-006). No
additional business logic beyond the two calls.

## Repository interfaces consumed (read-only)

- `LiabilityRepository.listActive(): Liability[]` — already exists in the core app; this
  feature adds no new methods to it, only new optional fields on the returned shape.
- `DebtPlannerPreferenceRepository`:
  - `get(): DebtPlannerPreference` — returns the singleton, creating a default
    (`avalanche`, `extraMonthlyPayment: 0`) on first read.
  - `save(pref: DebtPlannerPreference): void` — upserts the singleton.
