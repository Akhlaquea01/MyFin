# Quickstart: Validating the Personal Finance Manager (PWA)

This is a validation guide, not an implementation guide — it proves the feature works
end-to-end once built. Implementation steps belong in `tasks.md`.

## Prerequisites

- Node.js LTS and a package manager (npm) installed.
- Project dependencies installed (`npm install`) once the SvelteKit project from
  [plan.md](plan.md)'s Project Structure exists.
- A Chromium-based browser for local dev (best DevTools support for IndexedDB/Application
  panel inspection); Safari/iOS should be checked separately for the storage-persistence
  and biometric paths noted below.

## Run the app locally

```bash
npm run dev
```

Open the printed local URL. The app must load and be interactive with the browser's
network taken fully offline (DevTools → Network → Offline) after the first successful load
— this directly validates SC-009.

## Scenario 1 — Onboarding, lock, and persistence (User Story 1, FR-001–004, FR-044)

1. On first load, confirm the app forces PIN creation before showing any other screen.
2. Set a PIN. Confirm `navigator.storage.persisted()` becomes `true` in supporting
   browsers (check DevTools Application → Storage), or that the app shows the
   "storage not protected" warning where it isn't supported (Safari).
3. Reload the page; confirm the app requires the PIN again.
4. Wait 5 minutes idle (or trigger the auto-lock timer directly in a test build); confirm
   the app locks itself (FR-003).
5. Enter an incorrect PIN; confirm access is denied with no data shown.

**Pass condition**: SC-001 holds with zero exceptions across all of the above.

## Scenario 2 — Core ledger (User Story 2)

1. Create two accounts (e.g., "Bank" and "Cash").
2. Record an income transaction and an expense transaction, each against a category.
3. Confirm both account balances update immediately.
4. Record a transfer between the two accounts; confirm balances update on both sides and
   the transfer does not appear in income/expense totals.
5. Split one transaction across two categories; confirm the parts sum to the original.
6. Delete a transaction; confirm it disappears from the ledger but is recoverable from
   trash, and the account balance reflects the deletion.

**Pass condition**: SC-002 (dashboard/ledger reconciliation) holds after every step.

## Scenario 3 — Dashboard (User Story 3)

1. With the data from Scenario 2, open the dashboard.
2. Manually recompute total balance and net worth from the accounts, and compare to the
   dashboard's displayed figures — they must match exactly.

## Scenario 4 — Quick Add & bulk import (User Story 4)

1. Paste a sample payment-notification-style text into Quick Add; confirm a proposed
   transaction (amount, merchant, type) appears for review.
2. Paste the same text again; confirm it is flagged as a likely duplicate rather than
   silently created again (FR-020).
3. Import a small sample file of several such messages; confirm one unreviewed transaction
   is created per recognizable message, and unrecognized lines are reported rather than
   dropped (FR-021).

## Scenario 5 — Budgeting (User Story 5)

1. Set a monthly budget for a category used in Scenario 2.
2. Confirm the budget's actual-spent figure matches the transactions recorded in that
   category for the period.
3. Enable rollover on a budget, simulate a period rollover, and confirm the unused amount
   carries forward.

## Scenario 6 — Recurring finances (User Story 6)

1. Create a recurring rule (e.g., monthly rent).
2. Confirm an expected event appears ahead of its due date.
3. Record a matching transaction; confirm the event is marked matched.
4. Simulate a due date passing with no matching transaction; confirm it is flagged missed.

## Scenario 7 — Wealth & debt (User Story 7)

1. Add an investment holding with a valuation, and a liability with an outstanding
   balance.
2. Confirm net worth equals account balances + investment value − liabilities.

## Scenario 8 — Analytics (User Story 8)

1. With multi-month data present, open analytics.
2. Cross-check category totals and the net worth trend chart against the underlying data.

## Scenario 9 — Import/export & backup-restore (User Story 9)

1. Import a sample CSV with column mapping; confirm correct rows are created and malformed
   rows are reported (not silently dropped).
2. Export data to CSV/XLSX; confirm the export matches the current ledger.
3. Create a backup. Confirm the resulting file matches the shape in
   [contracts/backup-format.md](contracts/backup-format.md).
4. Clear local data (or use a second browser profile) and restore from the backup; confirm
   all data is reproduced exactly (SC-007).
5. Attempt to restore a deliberately corrupted copy of the backup file; confirm it is
   rejected with a clear error and existing data is untouched.

## Scenario 10 — Multi-tab handling (FR-045)

1. Open the app in one tab, then open it again in a second tab.
2. Confirm the second tab shows a blocked/read-only state directing the user to the first
   tab, rather than allowing concurrent writes.
3. Close the first tab; confirm the second tab becomes usable.

## Automated test coverage (Constitution Principle IV)

```bash
npm run test:unit  # Vitest — domain engines, Dexie repositories, and crypto round-trip
npm run test:e2e   # Playwright — scenarios 1, 2, 9, 10 above at minimum
```

All money-affecting engine changes must ship with passing unit tests before being
considered done, per the constitution's Development Workflow gate.
