# Phase 1 Data Model: Receipt & Photo Attachments

Conventions follow the core app's data model: UUID primary keys, integers for every
numeric/size field, `createdAt`/`updatedAt` timestamps, and AES-GCM-encrypted-at-rest
storage for the plaintext shape described below — including the image bytes themselves
(research.md §1).

## Attachment (new)

| Field         | Type      | Notes                                                                   |
| ------------- | --------- | ----------------------------------------------------------------------- |
| id            | UUID      | PK                                                                      |
| transactionId | UUID      | FK → Transaction                                                        |
| mimeType      | string    | One of `image/jpeg`, `image/png`, `image/webp` (research.md §7)         |
| data          | string    | Base64-encoded, compressed image bytes (research.md §1-2)               |
| sizeBytes     | integer   | Byte length of the _stored_ (post-compression) data, for display/limits |
| createdAt     | timestamp |                                                                         |
| updatedAt     | timestamp |                                                                         |

**Validation**:

- `mimeType` MUST be one of the three supported types (FR-004); anything else is rejected
  before an `Attachment` is ever constructed.
- A transaction MAY have at most 5 non-purged attachments (research.md §7); the 6th attempt
  is rejected with a clear message rather than silently dropped or silently replacing one.
- No independent soft-delete (`deletedAt`) field — an attachment's visibility is entirely
  derived from its parent transaction's `deletedAt` (soft-deleted alongside, restored
  alongside, purged alongside — research.md §5), the same precedent `GoalContribution`
  already established (spec 003) for a child record scoped to one parent.

## Entity Relationship Summary

```
Transaction 1---* Attachment   (visibility follows the parent transaction's deletedAt;
                                 hard-deleted in the same operation as a transaction purge)
```

## Changes to existing entities/services

- **`TransactionRepository`** (existing, `src/data/dexie/transactionRepository.ts`): gains a
  new `purge(key, id)` method — hard-deletes the transaction row and cascades to
  `TransactionSplit`, `TransactionTag`, and `Attachment` rows for that transaction, in one
  Dexie transaction (research.md §5). `softDelete`/`restore` are unchanged; because
  `Attachment` has no independent `deletedAt`, no changes are needed there for the
  soft-delete/restore path — it already works by construction.
- **`backupService.ts`** (existing): `BackupPayload.exportedEntities` gains `attachments:
Attachment[]`; `collectPayload`/`restoreBackup` gain the matching read/encrypt/clear/
  bulkPut steps, following the existing `transactionSplits` pattern exactly (research.md
  §6).
