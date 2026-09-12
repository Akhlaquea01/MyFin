# Quickstart: Multi-Account Transaction Import

Validation scenarios proving the feature works end-to-end, once implemented per
[plan.md](plan.md), [data-model.md](data-model.md), and
[contracts/import-account-resolution.md](contracts/import-account-resolution.md).

## Prerequisites

- App running locally (`npm run dev`) with onboarding completed and at least three accounts
  created, e.g. "Checking", "Savings", "Credit Card". One should be archived for Scenario 4.
- The **Import** page (existing, this feature extends it).

## Scenario 1 — Import one file covering several accounts (User Story 1)

1. Prepare a CSV with a `Date`, `Description`, `Amount`, and `Account` column, with rows for
   "Checking", "Savings", and "Credit Card".
2. On the Import page, choose the file, map `Date`/`Amount`/`Description` as usual, and set
   "Account column (optional)" to `Account`.
3. **Expect**: the preview shows a resolved-account column naming the correct account per row;
   the fallback "Account" dropdown becomes non-required/informational.
4. Click Import.
5. **Expect**: all rows are created under their respective accounts with no manual splitting
   (SC-001), and the result card shows a per-account count breakdown (SC-003) that matches the
   source file.

## Scenario 2 — A file with no account column behaves exactly as before (User Story 1)

1. Import a file identical in shape to today's single-account imports (no `Account` column
   mapped).
2. **Expect**: identical behavior to before this feature existed — every row imports to the
   one selected "Account" dropdown value, and the result card shows the original single-line
   summary with no per-account breakdown (FR-002, SC-004).

## Scenario 3 — Unresolvable account values are caught before import (User Story 2)

1. Prepare a file with an `Account` column where one row's value is blank and another is a
   typo (e.g. "Chekcing") that matches no existing account.
2. Map the `Account` column and view the preview.
3. **Expect**: both rows are visibly flagged in the preview (e.g. "not found" / "empty"), and
   proceeding with the import creates transactions for every other row while these two are
   excluded and listed in the result's skipped-rows section with a clear reason each
   (Acceptance Scenarios 2-3, FR-004, FR-005, SC-002).

## Scenario 4 — Archived accounts are valid import destinations (Edge Case)

1. Archive one account (e.g. "Old Wallet") via Accounts → Archive, while it still has no
   blocking active transactions constraint relevant here.
2. Prepare a file whose `Account` column references "Old Wallet" for one row.
3. Map the `Account` column and import.
4. **Expect**: that row resolves and imports successfully into "Old Wallet" — archived
   accounts are not excluded from column-based matching, even though they're excluded from the
   plain "Account" fallback dropdown (FR-003).

## Scenario 5 — A duplicated account name blocks the entire import (Clarification session, FR-006)

1. Create a second account also named "Checking" (the app does not prevent this today).
2. Prepare a file whose `Account` column references "Checking" for some rows (any of the other
   rows can reference unambiguous account names too).
3. Map the `Account` column.
4. **Expect**: the import is blocked before it starts — the UI clearly states that "Checking"
   matches more than one account and the user must rename one of them before retrying; no
   transactions are created for *any* row in the file, including ones referencing unambiguous
   accounts (SC-005).
5. Rename one of the two "Checking" accounts (e.g. to "Checking 2") and retry the same file.
6. **Expect**: the import now proceeds normally, rows referencing "Checking" resolving to
   whichever account still holds that name.

## Scenario 6 — Duplicate detection and balance updates stay correct across accounts (Edge Case)

1. Import a multi-account file where two different accounts each have a row with the same
   date and amount as an existing transaction already in that specific account (but not in the
   other).
2. **Expect**: only the account that actually has the matching existing transaction gets its
   row flagged as a possible duplicate (still created, per existing duplicate-flagging
   behavior); the other account's row imports without a duplicate flag. Both accounts' balances
   reflect their own newly created transactions correctly after the import completes.

## Automated coverage

These scenarios correspond to:

- `tests/unit/importService.test.ts` — `resolveAccountForRow` (Scenarios 1, 3, 4),
  `findAccountNameCollisions` (Scenario 5), and `importRows()`'s multi-account per-row
  resolution, per-account duplicate detection, per-account balance recalculation, and
  backward-compatible no-`accountColumn` path (Scenarios 1, 2, 6).
- `tests/e2e/importExportBackup.spec.ts` (or a new sibling spec) — Scenarios 1, 2, 3, 5
  end-to-end through the actual Import page UI.
