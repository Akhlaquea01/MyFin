# Phase 0 Research: Complete Data Template Export & Import

All items below were resolved from the existing codebase (no external research needed — this
feature composes entirely with patterns already proven in specs 001-010). Each entry follows
Decision / Rationale / Alternatives considered.

## 1. Is an unencrypted export of "all financial data" a Constitution Principle II violation?

**Decision**: No — treated as consistent with existing, already-shipped precedent. The
existing CSV/XLSX transaction export (`src/data/io/exportService.ts`, `ExportPage.tsx`)
already writes plaintext amounts, notes, account names, and category names to a downloaded
file today, with no encryption, and that shipped under the same constitution. Principle II's
"data at rest MUST be encrypted" governs the app's own persisted storage (IndexedDB); it does
not — and, given the pre-existing CSV/XLSX export, cannot be read to — forbid a file the user
explicitly, deliberately asks the app to produce and download outside its own storage.

**Rationale**: The user is the one initiating the export and choosing what to do with the
resulting file (keep it, move it to a new install, delete it); this is analogous to printing a
bank statement. The app's obligation is to make the encrypted-at-rest boundary and the
full-encrypted-backup alternative unambiguous (FR-012), not to prevent the user from ever
holding their own data in the clear.

**Alternatives considered**: Encrypting the template file too — rejected: it would collapse
this feature into a second, redundant implementation of the existing full backup (which is
already encrypted, already comprehensive, and already the documented disaster-recovery path),
eliminating the one property (human-readable, inspectable, editable) that makes this feature
worth having alongside it.

## 2. Import ordering and cross-file id remapping

**Decision**: `importTemplate` processes entity types in dependency order — accounts,
categories, merchants (+ aliases), tags, investment holdings (+ valuations), liabilities,
savings goals (+ contributions), budgets (+ items), recurring rules (+ expected events),
categorization rules (+ merchant category signals), net worth snapshots, then transactions
(+ splits, tags, attachments) last — building an in-memory `Map<oldId, newId>` per entity type
as each record is resolved (whether matched to an existing record or newly created). Every
later entity type resolves its foreign keys through these maps before creating anything.

**Rationale**: A template file's ids are only meaningful within that file; the destination
install already has its own ids for anything matched as a duplicate, and freshly created rows
get fresh `crypto.randomUUID()` ids per Constitution Principle VI. Processing "things with no
dependencies first, things that reference them last" is the only ordering that lets every
foreign key resolve in one pass with no backtracking. Transactions are processed last because
they are the one entity type that has multiple simultaneous dependencies (account, categories,
tags) and are also large in volume, so nothing else should have to re-scan them.

**Alternatives considered**: A multi-pass "create everything, patch references after" approach
— rejected: needlessly complex given a strict dependency order already exists (mirroring how
category parent/child ordering was already handled in spec 015's earlier draft) and requires
temporarily creating records with dangling/placeholder foreign keys, which the existing
repository `create()` methods aren't designed to accept.

## 3. Reusing the existing transaction duplicate rule (FR-008)

**Decision**: Extract the existing `duplicateKey`/`findDuplicateId` pair from
`src/data/io/importService.ts` (currently module-private) into an exported pair so
`templateService.ts` can call the exact same ±1-day-same-amount-per-account rule already used
by the ordinary file-import feature, rather than re-implementing it.

**Rationale**: One duplicate-transaction policy for the whole app, matching the precedent spec
003 set for extracting `dateMath.ts` for cross-feature reuse — two independent
implementations of "is this a duplicate transaction" would inevitably drift.

**Alternatives considered**: Re-implementing the same rule inline in `templateService.ts` —
rejected for the drift risk alone; also rejected re-using `importRows()` itself directly, since
that function is CSV/XLSX-row-shaped and doesn't fit a template's fully-formed `Transaction`
objects (with their own splits and tags) without an awkward re-serialization round-trip.

## 4. Trash is not part of the template

**Decision**: Every entity read for export comes from each repository's existing `list()`
(non-deleted only) — soft-deleted records are excluded from the template entirely.

**Rationale**: A template describes "the user's data," and every existing `list()` method
already treats soft-deleted rows as gone for every other purpose in the app (they only surface
in `TrashPage.tsx`). Including trash would also silently resurrect records the user explicitly
deleted the moment their template is re-imported into any install (including their own, after
a mistaken re-import).

**Alternatives considered**: Including soft-deleted rows with their `deletedAt` preserved —
rejected: adds meaningful complexity (importing a deleted row would need to decide whether to
recreate it as deleted, which nothing else in the app does today) for no benefit, since trash
is not what a "complete data template" is understood to mean.

## 5. Singleton preference rows (NotificationPreference, DebtPlannerPreference)

**Decision**: Treated exactly like every other "skip if already exists" entity type (research
§2's uniform rule), not given special "always overwrite" handling.

**Rationale**: Keeps exactly one import rule ("never overwrite existing data," FR-007/FR-012)
rather than carving out an exception for two specific rows. In practice this only matters the
first time a template is imported into a database that has genuinely never had that singleton
written yet — after normal onboarding, one already exists in any destination and is correctly
left untouched.

**Alternatives considered**: Always overwriting these two singletons from the file — rejected:
would violate the feature's core non-destructive guarantee (FR-012) for the sake of a
preference row a user could just as easily reconfigure by hand after import.

## 6. Performance: batching balance recalculation for large imports

**Decision**: `importTemplate` creates every transaction with the existing
`RecordOptions.deferBalance` flag (already used by bulk file import and text quick-add import),
then calls `TransactionEngine.recalculateAccountBalance` exactly once per distinct account
touched, after the transaction loop finishes — not once per transaction. The transaction loop
also yields to the event loop periodically, reusing the same interval convention already
established in `importService.ts`.

**Rationale**: `recalculateAccountBalance` is O(that account's transaction count); calling it
once per imported transaction on an account with N existing transactions makes an M-transaction
import O(M×N) instead of O(M+N), which is exactly the quadratic blowup `RecordOptions` already
exists to prevent in the ordinary bulk-import path. FR-014/SC-005 (thousands of transactions,
no UI freeze) require the same discipline here.

**Alternatives considered**: Recalculating per transaction for simplicity — rejected outright;
this is the exact anti-pattern `deferBalance` was introduced to solve, per its own doc comment
in `transactionEngine.ts`.

## 7. MerchantCategorySignal is a cache, not a duplicate-detectable record

**Decision**: A `MerchantCategorySignal` in the file (keyed by the file's `merchantId`,
remapped like any other merchant reference) is merged into the destination's existing signal
for that merchant (if any) by concatenating and re-capping the recent-category list to the
same `MIN_STREAK` bound the categorization engine already enforces, rather than being
skipped-if-exists or always-overwritten.

**Rationale**: Unlike every other entity in this feature, a `MerchantCategorySignal` has no
identity of its own beyond its merchant (`id` **is** the merchant id, per its own doc comment
in `entities.ts`) — "does this record already exist" is always true for any merchant that has
ever been auto-categorized, so a strict skip-if-exists rule would make importing this signal
pointless, while an overwrite would erase the destination's own learned signal. A merge best
matches what the signal represents (a rolling recent-history window).

**Alternatives considered**: Excluding `MerchantCategorySignal` from the template entirely —
rejected given the explicit "nothing out of scope" direction; it is genuinely user-derived
data (a byproduct of the user's own past categorization choices), just shaped differently from
every other entity here.

## 8. Where the UI lives

**Decision**: Both directions of this feature (export and import) are added to the existing
`ExportPage.tsx`, as a new section alongside (not replacing) the current CSV/XLSX export
buttons — mirroring how `BackupSettingsPage.tsx` already hosts both directions (backup
*and* restore) of the full encrypted backup on one screen.

**Rationale**: FR-012 requires this feature to be clearly discoverable alongside existing
export functionality and clearly distinguished from the full backup; putting both the export
and import actions for this feature on one page (rather than splitting import onto the
transaction-file-specific `ImportPage.tsx`, which is scoped to CSV/XLSX transaction rows per
spec 001/009) keeps the feature self-contained and easy to find.

**Alternatives considered**: Adding template import to `ImportPage.tsx` — rejected: that page
and `importService.ts` are scoped specifically to mapping arbitrary CSV/XLSX columns onto
transaction rows (spec 001/009); this feature's file has a fixed, self-describing structure
and covers far more than transactions, so it doesn't fit that page's existing mental model.
