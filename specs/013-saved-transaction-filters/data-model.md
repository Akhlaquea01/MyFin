# Data Model: Saved Transaction Filters

## Entities

### `SavedFilterView`

A user-named snapshot of the Transactions list's filter fields at the moment it was saved.

- **`id`** (`string`): Primary key (UUID).
- **`name`** (`string`): The user-provided name for the saved view.
- **`accountId`** (`string | null`): The ID of the account being filtered by, or null for all accounts.
- **`dateFrom`** (`string | null`): The ISO date string (YYYY-MM-DD) for the start date filter.
- **`dateTo`** (`string | null`): The ISO date string (YYYY-MM-DD) for the end date filter.
- **`freeText`** (`string | null`): The search text applied.
- **`tagIds`** (`string[]`): Array of tag IDs selected in the filter.
- **`createdAt`** (`number`): Epoch milliseconds.
- **`updatedAt`** (`number`): Epoch milliseconds.

> **Note**: `SavedFilterView` is not soft-deletable. Deletions will be hard deletes since they are just user preference state and not historical financial records (like transactions/accounts). This adheres to the spirit of Principle VI for non-financial state.

## Dexie Implementation

The `SavedFilterView` will be added to the Dexie database schema and will have its own repository `SavedFilterViewRepository`.

Table schema for `SavedFilterView`:
`'id, name, createdAt, updatedAt'` (We will index `name` to easily check for duplicates, and `createdAt` for sorting the list of saved views).

## Relationships

- References `Account.id` (via `accountId`). Soft relationship, not enforced by DB.
- References `Tag.id` (via `tagIds`). Soft relationship, not enforced by DB.

Validation rules:
- `name` MUST NOT be empty.
- Attempting to save with a `name` that exactly matches an existing `SavedFilterView.name` should prompt an overwrite or rename flow in the UI. The Repository can provide a `findByName` method to support this.
