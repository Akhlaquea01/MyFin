# Contract: Attachment Handling

This app has no external API; its "contracts" are the internal interfaces between the
browser-API utility (`src/lib/imageAttachment.ts`), the repository
(`src/data/dexie/attachmentRepository.ts`), and their callers, per Constitution Principle
III's one-way dependency rule.

## `src/lib/imageAttachment.ts`

### `validateAttachmentFile(file: File): { ok: true } | { ok: false; reason: string }`

Checks, before any processing: `file.type` is one of `image/jpeg`, `image/png`,
`image/webp` (FR-004); `file.size` does not exceed the raw-input cap (20MB, research.md §7).
Pure with respect to its input (reads only `file.type`/`file.size`, does no I/O), but not
unit-testable in the Node/Vitest environment in the domain sense — it's browser-file-object
shaped, not a Vitest-excluded concern; still covered by tests using a constructed `File`.

### `compressImage(file: File): Promise<{ mimeType: string; data: string; sizeBytes: number }>`

Draws `file` onto an off-screen canvas scaled to at most 1600px on its longest side,
re-encodes as JPEG (research.md §2), and returns the base64 `data` (no `data:` URL prefix —
just the raw base64 payload), the resulting `mimeType` (`image/jpeg`), and `sizeBytes` (the
decoded byte length of `data`). Requires a browser environment (`Image`, `canvas`) — not
callable from a pure Node test; covered by Playwright E2E, not Vitest unit tests.

## `src/data/dexie/attachmentRepository.ts`

### `AttachmentRepository.create(key, input: { transactionId; mimeType; data; sizeBytes }): Promise<Attachment>`

MUST reject (throw) if the transaction already has 5 non-purged attachments (research.md
§7, data-model.md).

### `AttachmentRepository.remove(key, id): Promise<void>`

Direct hard removal — an attachment has no independent soft-delete (data-model.md), so
"remove" here is real deletion, distinct from a transaction's own soft-delete.

### `AttachmentRepository.listForTransaction(key, transactionId): Promise<Attachment[]>`

### `AttachmentRepository.countsForTransactions(key, transactionIds: string[]): Promise<Record<string, number>>`

Bulk lookup for the "has an attachment" row indicator (research.md §4) — MUST be a single
query pass over `transactionIds`, not one query per id, to stay proportional to the visible
window rather than total transaction count.

### `AttachmentRepository.purgeForTransaction(key, transactionId): Promise<void>`

Hard-deletes every attachment for `transactionId`. Called only by
`TransactionRepository.purge` (below); never independently exposed in the UI, since an
attachment's lifecycle is entirely owned by its parent transaction.

## `src/data/dexie/transactionRepository.ts` (extended)

### `TransactionRepository.purge(key, id): Promise<void>`

Hard-deletes the `Transaction` row and, in the same Dexie transaction, cascades to its
`TransactionSplit` rows, `TransactionTag` rows, and (via
`AttachmentRepository.purgeForTransaction`) its `Attachment` rows (FR-006, SC-004,
research.md §5). MUST only be callable from Trash (i.e., the transaction MUST already be
soft-deleted) — purging a still-active transaction is not a supported call shape and MAY
throw if attempted, consistent with Constitution Principle VI's "permanent purge requires
explicit, separate user confirmation" (the UI only ever offers this action from within
Trash).

## Error cases

- `AttachmentRepository.create` beyond the 5-attachment cap → rejects with a message the UI
  surfaces directly to the user (FR-004's "clear message" requirement extends to this case
  by the same spirit, even though FR-004 is phrased around file type/size).
- `compressImage` on a corrupt/undecodable image file → rejects; the UI treats this
  identically to a failed `validateAttachmentFile` check (a clear error, no partial write).
