# Phase 1 Data Model: Tag-Based Filtering & Search for Transactions

No new Dexie table, no schema version bump, no new persisted entity (research.md §1, §7). This
feature only adds **query** shapes over the existing `Tag`/`TransactionTag` entities
(`src/domain/entities.ts:49`, `:83-86`) — it does not change how tags are created, assigned, or
stored.

## Existing entities this feature reads (unchanged)

| Entity              | Fields used                              | Source                          |
| ------------------- | ----------------------------------------- | -------------------------------- |
| `Tag`                | `id`, `name`                               | `src/domain/entities.ts:49`       |
| `TransactionTag`      | `transactionId`, `tagId`                   | `src/domain/entities.ts:83-86`    |
| `Transaction`         | `id`, `deletedAt`, `notes` (existing free-text field) | `src/domain/entities.ts:58-70` |

## TransactionFilter (extended)

`src/data/dexie/transactionRepository.ts:41-49`. One field changes shape; everything else is
unchanged:

| Field       | Type                | Notes                                                                                      |
| ----------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `tagIds`    | `string[] \| undefined` | **Replaces** `tagId?: string`. Empty/undefined = no tag filter. Non-empty = "matches any of these tag ids" (OR), per FR-002. Not currently called by any UI, so this is a non-breaking rename (research.md §2). |
| `freeText`  | `string \| undefined`  | **Unchanged shape**, extended semantics: now matches against `notes` OR any of the transaction's resolved tag names (FR-006), not `notes` alone. |
| *(all other fields — `accountId`, `categoryId`, `dateFrom`, `dateTo`, `includeDeleted`)* | unchanged | Compose with the tag filter exactly as they already compose with `categoryId` (research.md §2). |

## TagOption (new, UI/query-layer only — not persisted)

The shape the tag pick-list renders and narrows over. A thin projection of `Tag`, decrypted and
already scoped to "in use by a live transaction" (FR-009) before it reaches the UI.

| Field  | Type     | Notes                          |
| ------ | -------- | -------------------------------- |
| `id`   | `string` | `Tag.id`                        |
| `name` | `string` | `Tag.name`, original case as stored |

Produced by `TagRepository.listInUse(key)` (new), sorted case-insensitively by `name`.

## Relationships (query-time only, nothing new persisted)

```
transactionTags ──┐
                   ├──▶ anyOf(selectedTagIds) ──▶ candidate transactionIds (FR-001, FR-002)
(existing table)   ┘         (transactionRepository.ts, extended)

transactions.deletedAt ──┐
transactionTags          ├──▶ distinctTagIdsInUse() ──▶ TagRepository.listInUse() ──▶ TagOption[]
tags                     ┘         (NEW pure selector, tagFilterEngine.ts)              (FR-004, FR-009)

transactions.notes ──┐
transactionTags/tags ├──▶ transactionMatchesFreeText() ──▶ search() free-text step (FR-006, FR-007)
                      ┘         (NEW pure predicate, tagFilterEngine.ts)
```

No arrow writes to `Tag`, `TransactionTag`, or `Transaction` — every function this feature adds is
a read-only selector or predicate over data that already exists (Constitution Principle III: one-way
UI → Domain → Data flow stays intact; Principle VI: nothing new to soft-delete since nothing new is
stored).

## Validation rules (enforced by the pure engine, not storage — there is none new)

- `tagIds: []` (or `undefined`) behaves identically to "no tag filter" — never an error, never an
  empty-by-construction result (distinguish "no filter" from "filter that matches nothing").
- A tag with zero live (non-deleted-transaction) associations is excluded from
  `TagRepository.listInUse`'s result, even if it still has rows for soft-deleted transactions
  (FR-009, Edge Cases).
- Tag-name comparisons (pick-list narrowing, free-text tag match) are case-insensitive; tag *id*
  matching (the actual filter) is exact, since ids are already the sole de-duplication key.
