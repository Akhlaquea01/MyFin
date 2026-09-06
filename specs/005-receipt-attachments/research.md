# Phase 0 Research: Receipt & Photo Attachments

## 1. Storing image bytes through the existing JSON-based encryption

**Decision**: Convert the attached image to a base64 string and store it as an ordinary
field on the `Attachment` entity (`data: string`), encrypted exactly the way every other
entity already is — via the existing `encrypt`/`putEncrypted` (`src/data/crypto/
cryptoService.ts`, `src/data/dexie/encryptedTable.ts`). No new crypto code.

**Rationale**: `encrypt()` only accepts JSON-serializable values (it `JSON.stringify`s its
input before encrypting) — a `File`/`Blob` cannot be passed directly. Base64-encoding the
compressed image bytes turns them into an ordinary string field, so the _entire_ entity
(including the image data) goes through the same AES-GCM path as every other table,
satisfying FR-002 by reuse rather than by introducing a second storage mechanism.

**Alternatives considered**: Storing the raw `Blob` in a non-encrypted IndexedDB store and
encrypting only a reference — rejected outright; it would mean image bytes touch disk
unencrypted, violating Constitution Principle II. A separate binary-safe encryption path
(encrypting an `ArrayBuffer` directly rather than JSON) — rejected as unnecessary complexity
for the resulting image sizes (research.md §2 keeps them small) when the existing
JSON/base64 path already works and requires zero new crypto surface to review.

## 2. Client-side image compression

**Decision**: Before storing, downscale the image to a bounded maximum dimension (e.g.
1600px on the longest side) and re-encode as JPEG at a fixed quality, using the native
Canvas API (`<canvas>` + `HTMLCanvasElement.toBlob`/`toDataURL`) in a new browser-only
utility, `src/lib/imageAttachment.ts` — not in `src/domain/`, since it requires DOM APIs
(`Image`, `canvas`) that don't run in the Node/Vitest unit-test environment domain code is
held to.

**Rationale**: Meets FR-005/SC-003 (bound stored size, e.g. under 500KB) using only
browser-native APIs — no new dependency (Constitution Principle V). Placing it in `src/lib/`
matches this codebase's existing convention for browser-API-dependent utilities that aren't
pure domain logic (e.g. `src/lib/webauthn.ts`, `src/lib/singleInstance.ts`).

**Alternatives considered**: An image-compression npm package — rejected; the Canvas API
already does this natively and pulling in a dependency for it would violate Principle V's
"free/OSS only, no dependency where the platform already provides the capability" spirit
already followed elsewhere in this codebase (e.g. no date-math library, per specs 002/003).

## 3. Where the "attach" UI lives — no new transaction-detail page

**Decision**: Add an "Attachments" action to each row of the existing
`src/pages/TransactionsPage.tsx` table (a small icon button, badge-marked when the
transaction already has at least one), opening a `Dialog` that lists that transaction's
attachments (thumbnails), lets the user add more (file input, `accept="image/*"`, no camera-
specific UI needed beyond the OS's own file picker offering "Camera" on supporting devices)
or view one full-size or remove one.

**Rationale**: This codebase has no transaction-detail or transaction-edit screen at all
today (`TransactionEngine.editTransaction` exists but is called from nowhere) — building one
purely to host attachment management would be significant scope beyond what this feature
asks for. Every Acceptance Scenario is phrased in terms of an already-existing transaction
in a list, not a creation/edit flow, so a per-row action on the existing list is a complete,
minimal answer.

**Alternatives considered**: Building a full transaction-detail page — rejected as
unnecessary scope for what the spec actually requires. Adding attachment capture to
`NewTransactionPage.tsx`'s creation flow — rejected for the same reason; no Acceptance
Scenario asks for it, and it would couple attachment upload timing to transaction creation
timing for no stated benefit.

## 4. Keeping the row list fast at scale (SC-008 precedent)

**Decision**: `TransactionsPage.tsx` already virtualizes past 200 rows (only the visible
window's rows are ever mounted at once). The "has an attachment" indicator is populated via
one bulk lookup, `AttachmentRepository.countsForTransactions(key, transactionIds)`, run only
for the currently-_visible_ window of transaction ids (re-run whenever that window changes),
never for the full list.

**Rationale**: A per-row individual query for "does this transaction have an attachment"
would reintroduce the exact N-queries-per-render problem the existing virtualization was
built to avoid. Scoping the bulk lookup to the visible window keeps it proportional to
viewport size, not total transaction count, regardless of how many transactions exist.

**Alternatives considered**: Eagerly loading attachment counts for every transaction on
page load — rejected; defeats the purpose of virtualizing a 10k+-row list in the first
place.

## 5. Permanent purge — a small, deliberately scoped addition, not a new feature

**Decision**: This codebase currently has **no permanent-purge flow for any entity** —
`TrashPage.tsx` only offers Restore for Accounts/Transactions/Savings Goals, and nothing
calls a hard-delete repository method anywhere. Since FR-006 and SC-004 require attachments
to be permanently deleted when their parent transaction is permanently purged, this feature
adds exactly one new capability to make that requirement real and testable: a "Delete
forever" action in `TrashPage.tsx`'s existing Transactions section, backed by a new
`TransactionRepository.purge(key, id)` that hard-deletes the transaction and cascades to its
`TransactionSplit`, `TransactionTag`, and `Attachment` rows in one transaction. No purge
action is added anywhere else (Accounts, Savings Goals) — that is explicitly out of scope
for this feature.

**Rationale**: Without this, FR-006's second half ("when permanently purged... permanently
deleted") would be unreachable dead code with no way for a user to ever trigger it, and
SC-004 ("zero orphaned attachment data... after a transaction is permanently purged") would
be untestable end-to-end. Constitution Principle VI already establishes that "permanent
purge requires explicit, separate user confirmation" as a general rule this app's Trash
screen was always meant to support — completing it for Transactions specifically (the one
entity this feature's attachments hang off of) is the minimum needed to make this feature's
own requirements true, not a general-purpose purge feature for every entity.

**Alternatives considered**: Leaving FR-006's purge half unimplemented/untestable — rejected,
it's an explicit functional requirement and success criterion. Building purge for every
soft-deletable entity — rejected as unrelated scope expansion; noted separately as a
follow-up opportunity, not bundled into this feature.

## 6. Backup/restore integration — explicit, not automatic

**Decision**: `src/data/io/backupService.ts` explicitly enumerates every table it backs up
(no generic "loop over all Dexie tables" mechanism exists) — a new `attachments` table must
be added to `BackupPayload.exportedEntities`, `collectPayload`'s reads, and
`restoreBackup`'s encrypt/transaction/clear/bulkPut lists, following the exact pattern
already used for `transactionSplits` (a table keyed by `transactionId`, no independent
soft-delete).

**Rationale**: Confirmed by reading `backupService.ts` directly — there is no shortcut here;
every table is hand-listed in five separate places. (Separately: this same investigation
found that specs 002/003/004's newer tables were never added to this file either — that
pre-existing gap has been flagged for a follow-up task, not folded into this feature, to
keep this feature's diff focused on what it actually owns.)

**Alternatives considered**: None — this is a direct consequence of how the file is already
structured, not a design choice this feature gets to make differently.

## 7. Validation limits

**Decision**: Accept only `image/jpeg`, `image/png`, and `image/webp` MIME types (matching
the spec's own Assumption); reject a raw input file above 20MB before attempting to process
it (guards against hanging the browser trying to canvas-decode something absurd, well above
any real phone-camera photo); cap at 5 attachments per transaction (per the spec's own
Assumption of "a reasonable... limit").

**Rationale**: Directly implements FR-004 and the spec's Assumptions section; the 20MB
pre-check is a defensive bound the spec doesn't specify a number for but requires ("exceeds
a defined maximum size").

## 8. No new dependencies

**Decision**: None beyond native browser APIs (`Canvas`, `FileReader`/`<input type="file">`)
already used elsewhere in this codebase for file handling.
