# Quickstart: Personal Lending & Borrowing (IOU) Tracking

Validation scenarios proving the feature works end-to-end, once implemented per
[plan.md](plan.md), [data-model.md](data-model.md), and
[contracts/loan-progress-engine.md](contracts/loan-progress-engine.md).

## Prerequisites

- App running locally (`npm run dev`) with onboarding completed.
- At least one account exists (e.g. "Cash", opening balance ₹5,000) with a known balance.

## Scenario 1 — Record a loan and see the account move (User Story 1)

1. Note the "Cash" account's current balance.
2. Record a new loan: person "Asha" (new), direction "lent", amount ₹1,000, account "Cash",
   due date 30 days from today.
3. **Expect**: "Cash" balance decreases by ₹1,000. Asha appears in the People list with an
   outstanding "owed to you" balance of ₹1,000.
4. Record a second loan: person "Rohit" (new), direction "borrowed", amount ₹500, account
   "Cash", no due date.
5. **Expect**: "Cash" balance increases by ₹500 relative to step 3. Rohit appears with an
   outstanding "you owe" balance of ₹500.

## Scenario 2 — Partial repayments down to settled (User Story 2)

1. Against Asha's ₹1,000 loan from Scenario 1, log a repayment of ₹400 into "Cash".
2. **Expect**: "Cash" balance increases by ₹400; Asha's outstanding balance drops to ₹600;
   the loan still shows as open.
3. Attempt to log a repayment of ₹700 (exceeds the ₹600 remaining).
4. **Expect**: rejected with a message that it exceeds the remaining balance (FR-007);
   nothing changes.
5. Log a repayment of exactly ₹600.
6. **Expect**: Asha's loan balance reaches ₹0 and is shown as settled (by repayment); "Cash"
   balance reflects both repayments.
7. Attempt to log another repayment against the now-settled loan.
8. **Expect**: rejected — the loan is already settled.

## Scenario 3 — People list and Dashboard totals (User Story 3)

1. With Scenario 1-2's data (Asha settled at ₹0; Rohit still owing you ₹500 — i.e. you owe
   Rohit ₹500), record one more loan: "lent" ₹300 to a new person "Meera", due date
   yesterday.
2. Open the People list.
3. **Expect**: Meera shows an outstanding "owed to you" balance of ₹300, flagged overdue
   (due date already passed). Asha shows ₹0 / not listed as outstanding. Rohit shows ₹500
   "you owe".
4. Open the Dashboard.
5. **Expect**: the summary tile shows "You're owed ₹300" (Meera only — Asha is settled) and
   "You owe ₹500" (Rohit).

## Scenario 4 — Overdue reminder surfaces once (User Story 4)

1. With Meera's overdue ₹300 loan from Scenario 3 still open, reload/reopen the app.
2. **Expect**: a reminder referencing Meera's overdue loan is surfaced (subject to
   notification permission being granted, same precondition as existing recurring/budget
   reminders).
3. Reopen the app again without logging any repayment.
4. **Expect**: the same reminder is not surfaced a second time (dedup via
   `NotifiedItemRepository`, per `research.md` §4).
5. Log a repayment that fully settles Meera's loan, then reopen the app.
6. **Expect**: no further reminder appears for that loan.

## Scenario 5 — Write off a loan (User Story 5)

1. Record a new loan: "lent" ₹200 to Rohit, account "Cash".
2. Note "Cash" balance.
3. Write off this loan.
4. **Expect**: "Cash" balance is unchanged; the loan's outstanding balance becomes ₹0 and is
   shown as settled-by-write-off (distinguishable from settled-by-repayment); it disappears
   from Rohit's outstanding total and the Dashboard tile.
5. Open Rohit's loan history.
6. **Expect**: the written-off ₹200 loan and its write-off are still visible in the history.

## Scenario 6 — Deleting a person with open loans is blocked (Edge Case / FR-015)

1. Attempt to delete Rohit (who still has an open ₹500 "borrowed" loan from Scenario 1-3).
2. **Expect**: deletion is blocked with an explanation that open loans must be settled or
   written off first.
3. Write off or fully repay Rohit's remaining loan, then retry deleting Rohit.
4. **Expect**: deletion now succeeds (soft delete — Rohit disappears from the active People
   list and appears in Trash, per FR-016).

## Scenario 7 — Undo a mis-logged repayment (Edge Case)

1. Record a new loan: "lent" ₹1,000 to a new person "Divya", account "Cash".
2. Log a repayment of ₹100 by mistake (should have been ₹1,000... or just wrong entirely).
3. Note "Cash" balance and Divya's outstanding balance after the repayment.
4. Delete (soft-delete/undo) that repayment from Trash or the loan's history.
5. **Expect**: "Cash" balance and Divya's outstanding balance both revert to what they were
   before the mistaken repayment (data-model.md's `LoanRepaymentRepository.softDelete`
   contract).

## Scenario 8 — Net worth includes open loans (FR-014 / SC-006)

1. Note the app's current total net worth (Net Worth page).
2. Record a new "lent" loan of ₹500 from any account.
3. **Expect**: net worth is unchanged (cash decreased by ₹500, but the ₹500 is now an open
   receivable counted as an asset — see `research.md` §5) — not decreased by ₹500.
4. Record a new "borrowed" loan of ₹300 into any account.
5. **Expect**: net worth is unchanged again (cash increased by ₹300, offset by ₹300 counted
   as a liability).
6. Write off the ₹500 "lent" loan from step 2.
7. **Expect**: net worth now decreases by ₹500 (the receivable is gone, but the cash was
   already spent when it was lent) — the point at which forgiving a debt actually costs you.
