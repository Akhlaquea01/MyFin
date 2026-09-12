# Phase 0: Research

## 1. Storage of Filter Criteria

- **Decision**: Store filter criteria in a strongly-typed, flattened structure in IndexedDB rather than an opaque JSON string or generic key-value pairs.
- **Rationale**: The currently supported fields are `accountId`, `dateFrom`, `dateTo`, `freeText`, and `tagIds`. While the feature should scale to new fields, maintaining strongly-typed optional fields allows TypeScript to provide type safety throughout the UI layer and repository layer, and makes Dexie index definitions straightforward.
- **Alternatives considered**: Storing an opaque JSON blob inside a `filterState` string column. This was rejected because it loses type safety and makes it harder to run migrations or queries if needed in the future, even if currently we just load them into memory.

## 2. Handling Missing/Deleted Entities (e.g. Accounts/Tags)

- **Decision**: We will not add foreign key constraints or cascade deletes to `SavedFilterView`. When applying a filter view in `TransactionsPage.tsx`, it will verify if the `accountId` exists in the currently loaded accounts list and `tagIds` exist in the loaded tags list. If missing, it will drop them from the applied state and display a toast notification (as per FR-008).
- **Rationale**: IndexedDB doesn't natively enforce foreign keys. Manually cascading deletes for saved filters adds unnecessary overhead. The UI already has to handle potentially stale values gracefully.
- **Alternatives considered**: Adding hook-ins to `AccountRepository.delete` and `TagRepository.delete` to clean up saved filters. Rejected as overly complex and unnecessary per the explicit edge-case requirement.
