# Quickstart: Complete Data Template Export & Import

Validation scenarios proving the feature works end-to-end, once implemented per
[plan.md](plan.md), [data-model.md](data-model.md), and
[contracts/template-service.md](contracts/template-service.md).

## Prerequisites

- App running locally (`npm run dev`) with onboarding completed.

## Scenario 1 — Export everything, inspect the file (User Story 1)

1. Set up a small but varied dataset: 2 accounts, 3 categories (one a subcategory), a budget,
   a transaction with a category split and a tag, an investment holding, a liability, and a
   savings goal with one contribution.
2. Export a Data Template from the Export page.
3. **Expect**: one JSON file downloads. Opening it in a text editor shows every one of the
   above records, plain and readable, with correct cross-references (e.g. the transaction's
   `categoryId` matches the category's `id`).
4. **Expect**: the file contains no PIN hash, salt, or biometric data anywhere (FR-004).

## Scenario 2 — Fresh-install import recreates everything (User Story 2)

1. Using the file from Scenario 1, complete onboarding on a fresh install (or a cleared
   database) with no data.
2. Import the Data Template file.
3. **Expect**: a result summary shows every record type created (2 accounts, 3 categories, 1
   budget, 1 transaction, 1 investment holding, 1 liability, 1 savings goal, 1 contribution,
   etc.), zero skipped, zero flagged.
4. **Expect**: the subcategory now shows the correct parent; the transaction shows the correct
   account, category, and tag; the account balances reflect the imported transaction.

## Scenario 3 — Invalid file is rejected outright (User Story 2 / Edge Case)

1. Attempt to import a text file that is not valid JSON, then a JSON file missing the expected
   `container`/`entities` structure.
2. **Expect**: both are rejected with a clear explanation and create nothing (FR-009).

## Scenario 4 — Overlapping import: skip, create, and flag together (User Story 3)

1. Starting from the state after Scenario 2, add one more category ("Travel", new) directly in
   the app, then re-import the exact same file from Scenario 1.
2. **Expect**: the result summary shows the 2 accounts, existing categories, budget,
   investment holding, liability, and savings goal/contribution all reported as skipped
   (already exist) — none duplicated. "Travel" is untouched (not present in the file, not
   affected by the import).
3. **Expect**: the transaction from the file is reported as created again, but flagged as a
   likely duplicate (same account/date/amount as the one already imported in Scenario 2) —
   matching the app's existing file-import duplicate behavior (FR-008) — leaving two
   transactions, one flagged `unreviewed`, for the user to reconcile via the Review Queue.

## Scenario 5 — A resolved-duplicate transaction doesn't steal an attachment (Edge Case)

1. On a fresh install, import a template whose one transaction has one receipt attachment.
2. **Expect**: the transaction and its attachment are both created; the attachment is visible
   on that transaction.
3. Re-import the same file.
4. **Expect**: the transaction is created again and flagged as a duplicate (Scenario 4's
   behavior), but the attachment from the file is reported as skipped rather than attached to
   either transaction ambiguously (data-model.md's Attachment row).

## Scenario 6 — An unresolvable relationship degrades gracefully (Edge Case)

1. Hand-edit an exported template's JSON so one `Budget` entry's `categoryId` points to a
   category id that exists nowhere else in the file, and delete that category from the app
   too (or use a fresh install).
2. Import the edited file.
3. **Expect**: every other record in the file still imports normally; the one broken budget is
   skipped and reported with an "unresolved relationship" reason, not a failed import.

## Scenario 7 — Large dataset does not freeze the app (FR-014 / SC-005)

1. On an installation with a large transaction history (or after a large ordinary CSV import),
   export a Data Template.
2. **Expect**: export completes, showing progress if it takes more than a moment, without the
   page becoming unresponsive.
3. Import that same large file into a fresh install.
4. **Expect**: import completes the same way — visible progress, no frozen UI — and the
   resulting account balances match the source installation's.

## Scenario 8 — Re-importing the exact same file twice changes nothing further the second time (Edge Case)

1. Take the end state after Scenario 4 (one already-flagged duplicate transaction, everything
   else skipped) and import the same original file a third time.
2. **Expect**: structural records are skipped exactly as before (no further duplicates); the
   transaction is created and flagged as a duplicate a third time, consistent with the app's
   existing file-import duplicate rule always creating a flagged row rather than deduping
   silently — this is expected, not a bug (FR-008's documented behavior).
