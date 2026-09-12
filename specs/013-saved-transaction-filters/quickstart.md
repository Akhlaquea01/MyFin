# Quickstart: Validation Guide for Saved Transaction Filters

This guide documents the end-to-end scenarios to validate the "Saved & Smart Transaction Filters" feature. 
These validations assume the application is running locally.

## Prerequisites
- The app should be running via `npm run dev` and loaded in the browser.
- The user is logged in (has completed onboarding and entered their PIN).
- The user has at least one account and some transactions/tags to filter on.

## Scenario 1: Save and Apply a Filter View
**Goal**: Verify a user can save the current filter combination and apply it later.

1. **Setup**: Navigate to the Transactions page.
2. **Action**:
   - Set the Account filter to a specific account (e.g. "Checking").
   - Set the Tag filter to a specific tag (e.g. "Groceries").
   - Click the new "Save View" button (which should appear next to the filter controls).
   - In the dialog, enter the name "Checking Groceries" and submit.
   - Clear the filters (e.g., set Account to "All", clear Tags).
   - Open the "Saved Views" dropdown/list and select "Checking Groceries".
3. **Expected Outcome**:
   - The Account filter is instantly set back to "Checking".
   - The Tag filter is instantly set back to "Groceries".
   - The transaction list reflects these applied filters.

## Scenario 2: Overwrite Existing View
**Goal**: Verify duplicate names trigger an overwrite prompt.

1. **Setup**: Follow Scenario 1 to create "Checking Groceries".
2. **Action**:
   - Change the Tag filter to "Dining".
   - Click "Save View".
   - Enter "Checking Groceries" as the name and submit.
3. **Expected Outcome**:
   - A prompt/dialog appears asking to overwrite the existing view or choose a different name.
   - Confirming the overwrite updates the saved view. Applying "Checking Groceries" now sets the Tag filter to "Dining".

## Scenario 3: Missing Reference Handling
**Goal**: Verify applying a saved view doesn't break when underlying entities are deleted.

1. **Setup**: Create a tag called "TemporaryTag". Navigate to Transactions, filter by this tag, save the view as "Temp View".
2. **Action**:
   - Navigate to Settings/Tags and delete "TemporaryTag".
   - Navigate back to Transactions and select "Temp View".
3. **Expected Outcome**:
   - The application does not crash or throw an error.
   - A toast notification informs the user that some filter criteria could not be applied.
   - The Tag filter remains clear, while any other valid filters captured in "Temp View" are successfully applied.

## Scenario 4: Manage Views
**Goal**: Verify renaming and deleting saved views works properly.

1. **Setup**: Create a saved view named "To Be Deleted".
2. **Action**:
   - Open the "Saved Views" list.
   - Click the Edit/Rename button next to "To Be Deleted", rename it to "Renamed View".
   - Verify the list shows "Renamed View".
   - Click the Delete button next to "Renamed View".
3. **Expected Outcome**:
   - Renaming works and the view is still selectable.
   - Deletion removes the view from the list immediately.
   - The currently active filter controls and transaction list are unaffected by the deletion.
