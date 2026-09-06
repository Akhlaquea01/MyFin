# Quickstart: Debt Payoff Planner

Validation scenarios proving the feature works end-to-end, once implemented per
[plan.md](plan.md), [data-model.md](data-model.md), and
[contracts/debt-payoff-engine.md](contracts/debt-payoff-engine.md).

## Prerequisites

- App running locally (`npm run dev`, per the core project's existing setup) with onboarding
  completed and at least one liability creatable via the existing Liabilities page.
- Two test liabilities, deliberately chosen so avalanche and snowball disagree on ordering
  (one has the smaller balance, the other the higher rate):
  - **Card A**: `credit_card`, outstanding balance ₹5,000, interest rate 12.00% APR, minimum
    payment ₹500/mo. Smaller balance, lower rate.
  - **Loan B**: `loan`, outstanding balance ₹50,000, interest rate 36.00% APR, minimum
    payment (EMI) ₹2,000/mo. Larger balance, higher rate.

## Scenario 1 — Generate an avalanche plan (User Story 1)

1. Open the Debt Payoff Planner from the app navigation.
2. Select "Avalanche" strategy.
3. **Expect**: Loan B (36% APR) is ranked above Card A (12% APR); each shows a projected
   payoff date; the overall plan shows a combined debt-free date and total interest.

## Scenario 2 — Generate a snowball plan (User Story 1)

1. With the same two liabilities, select "Snowball" strategy.
2. **Expect**: Card A (₹5,000 balance) is ranked above Loan B (₹50,000 balance) — opposite of
   avalanche ordering, since Card A has the smaller balance despite the lower rate.

## Scenario 3 — Apply an extra payment and observe the waterfall (User Story 2)

1. On the avalanche plan (Loan B ranked first), enter an extra monthly payment of ₹1,000.
2. **Expect**: Combined payoff date moves earlier and total interest decreases versus
   Scenario 1's minimums-only plan.
3. Continue until Loan B's simulated balance reaches zero in the schedule.
4. **Expect**: From the following simulated month onward, Loan B's ₹2,000 minimum payment is
   added to Card A's allocation (₹1,000 extra + ₹2,000 waterfall = ₹3,000/mo extra on Card A).

## Scenario 4 — Compare strategies side by side (User Story 3)

1. With the ₹1,000 extra payment set, open the comparison view.
2. **Expect**: Avalanche and snowball are shown side by side with months-to-debt-free and
   total interest paid for each, matching Scenarios 1–3's individually generated plans.

## Scenario 5 — Missing data prompts before inclusion (Edge Case / FR-008)

1. Create a third liability with no interest rate or minimum payment set.
2. Open the planner.
3. **Expect**: The new liability is excluded from the generated plan and listed separately
   as needing an interest rate and minimum payment before it can be included.

## Scenario 6 — Non-converging warning (FR-010)

1. Set Loan B's minimum payment to an amount smaller than its monthly interest accrual
   (e.g., ₹1,000/mo at 36% APR on ₹50,000, where monthly interest ≈ ₹1,500).
2. Open the planner with zero extra payment.
3. **Expect**: Loan B is flagged as non-converging (balance will never decrease) rather than
   showing a plan with no payoff date or an infinite loop.

## Automated coverage

These scenarios correspond to:

- `tests/unit/debtPayoffEngine.test.ts` — Scenarios 1, 2, 3, 5, 6 (pure engine logic,
  reconciled against hand-built amortization tables per Constitution Principle IV).
- `tests/integration/debtPlannerPreferenceRepository.test.ts` — persistence of strategy /
  extra-payment preference across sessions.
- `tests/e2e/debtPayoffPlanner.spec.ts` — Scenarios 1–4 end-to-end through the UI.
