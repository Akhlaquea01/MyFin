---
description: 'Task list template for feature implementation'
---

# Tasks: Receipt & Photo Attachments

**Input**: Design documents from `/specs/005-receipt-attachments/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/attachment-service.md](contracts/attachment-service.md),
[quickstart.md](quickstart.md)

**Tests**: Included for anything that can run in Vitest (`validateAttachmentFile`, the
repository layer). `compressImage` requires a real browser canvas and is only exercised by
the E2E suite — Constitution Principle IV's test-first mandate does not apply to this
feature (no money-affecting engine; see plan.md's Constitution Check), but repository/
validation logic still gets tests as good practice.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2/P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths below are real paths in this repository, following the conventions in
  `src/data/dexie/wealthRepository.ts` (repository pattern), `src/lib/webauthn.ts`
  (browser-API utility pattern), and `src/data/io/backupService.ts` (the file this feature
  extends for Story 3).

---

## Phase 1: Setup

**Purpose**: Establish a clean baseline before touching any code

- [x] T001 Confirm no new npm dependency is required (per [research.md](research.md) §8 —
      native Canvas/File APIs only) and run the existing test suite (`npm run test`) to
      confirm it passes cleanly before starting, establishing a clean baseline to diff
      against.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `Attachment` entity and its storage — needed by every user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 [P] Add the `Attachment` interface to `src/domain/entities.ts` per
      [data-model.md](data-model.md): `id`, `transactionId`, `mimeType`, `data`,
      `sizeBytes`, `createdAt`, `updatedAt` — no `deletedAt` (research.md §5/data-model.md:
      visibility is entirely derived from the parent transaction).
- [x] T003 [P] Add an `attachments` encrypted table to `src/data/dexie/db.ts`:
      `AttachmentRow extends EncryptedRow { transactionId: string }`, add the property to
      `MyFinDatabase`, and bump to `this.version(5).stores({ attachments: 'id,
transactionId' })` (additive-only per Dexie's versioning model; do not modify earlier
      `version()` blocks).

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Attach a Receipt to a Transaction (Priority: P1) 🎯 MVP

**Goal**: Attach, view full-size, and remove an image attachment on an existing transaction;
reject unsupported/oversized files; keep attachments through soft-delete/restore for free;
and make permanent purge (Edge Case, FR-006/SC-004) real and testable, since no such flow
exists anywhere in this codebase yet (research.md §5).

**Independent Test**: Create a transaction, attach an image file to it, reopen the
transaction later, and verify the same image displays correctly (per
[quickstart.md](quickstart.md) Scenarios 1, 2, 4, 6).

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they fail before writing the implementation.

- [x] T004 [P] [US1] Write failing unit tests in `tests/unit/imageAttachment.test.ts` for
      `validateAttachmentFile(file)`: a JPEG/PNG/WebP `File` under the size cap passes; a
      `.pdf`-typed `File` is rejected with a reason; a `File` above the 20MB raw-input cap is
      rejected with a reason (research.md §7, [quickstart.md](quickstart.md) Scenario 2).
      Construct `File` objects directly (`new File([...], name, { type })`) — no real image
      bytes needed for this layer.
- [x] T005 [P] [US1] Write failing integration tests in
      `tests/integration/attachmentRepository.test.ts` for `AttachmentRepository`
      (`create`/`listForTransaction`/`remove`/`countsForTransactions`): two attachments on
      one transaction are both listed and independently removable
      ([quickstart.md](quickstart.md) Scenario 5 precursor); a 6th `create` on the same
      transaction is rejected (research.md §7); and for the not-yet-existing
      `TransactionRepository.purge(key, id)`: it hard-deletes the transaction plus its
      `TransactionSplit`, `TransactionTag`, and `Attachment` rows in one call, and throws if
      attempted on a transaction that is not already soft-deleted (research.md §5,
      [quickstart.md](quickstart.md) Scenario 6).

### Implementation for User Story 1

- [x] T006 [P] [US1] Implement `validateAttachmentFile` and `compressImage` in
      `src/lib/imageAttachment.ts` per
      [contracts/attachment-service.md](contracts/attachment-service.md) and
      [research.md](research.md) §2/§7: `compressImage` uses `createImageBitmap` + an
      off-screen `<canvas>` scaled to at most 1600px on the longest side, re-encoded as JPEG
      via `canvas.toBlob(..., 'image/jpeg', 0.8)`, then base64-encoded. Depends on nothing
      beyond Foundational. Must make T004's tests pass.
- [x] T007 [US1] Implement `AttachmentRepository` (`create` — enforcing the 5-attachment cap
      per transaction, `remove`, `listForTransaction`, `countsForTransactions`,
      `purgeForTransaction`) in `src/data/dexie/attachmentRepository.ts` per
      [contracts/attachment-service.md](contracts/attachment-service.md), following the
      `LiabilityRepository` pattern in `src/data/dexie/wealthRepository.ts`. Depends on T002,
      T003. Must make T005's `AttachmentRepository` tests pass.
- [x] T008 [US1] Add `purge(key, id)` to `TransactionRepository` in
      `src/data/dexie/transactionRepository.ts`: throws if the transaction is not already
      soft-deleted (Constitution Principle VI — purge only from Trash); otherwise, in one
      `db.transaction('rw', [db.transactions, db.transactionSplits, db.transactionTags,
db.attachments], ...)`, hard-deletes the transaction row and all of its
      `transactionSplits`/`transactionTags`/`attachments` rows (calling
      `AttachmentRepository.purgeForTransaction` for the last one). Depends on T007. Must
      make T005's `purge` tests pass.
- [x] T009 [US1] Add an "Attachments" action to each row of `src/pages/TransactionsPage.tsx`
      (icon button) opening a `Dialog` for that transaction: a hidden `<input type="file"
accept="image/*">` triggered by an "Add" button that runs `validateAttachmentFile` →
      `compressImage` → `AttachmentRepository.create` (showing a clear error via `toast` on
      rejection, per FR-004); a thumbnail grid of that transaction's attachments (from
      `AttachmentRepository.listForTransaction`) with a full-size view (a nested `Dialog` or
      lightbox) and a remove action per thumbnail; and a bulk "has an attachment" indicator
      on each visible row, refreshed via `AttachmentRepository.countsForTransactions` only
      for the currently-_visible_ window of transaction ids (research.md §4 — never one
      query per row). Depends on T006, T007.
- [x] T010 [US1] Add a "Delete forever" action to `src/pages/TrashPage.tsx`'s existing
      Transactions section, calling the new `TransactionRepository.purge`, with a
      confirmation step before it fires (Constitution Principle VI's "explicit, separate
      user confirmation"). Depends on T008.

**Checkpoint**: User Story 1 is fully functional and independently testable — attach, view,
remove, soft-delete/restore, and permanent purge (with attachment cascade) all work.

---

## Phase 4: User Story 2 - Multiple Attachments per Transaction (Priority: P2)

**Goal**: A transaction can hold more than one attachment, each independently viewable and
removable.

**Independent Test**: Attach two images to the same transaction and verify both are stored
and independently viewable/removable (per [quickstart.md](quickstart.md) Scenario 5).

### Implementation for User Story 2

- [x] T011 [US2] _(Done as part of T005/T007/T009 — `AttachmentRepository` already enforces
      a 5-attachment cap rather than a 1-attachment limit, and `TransactionsPage.tsx`'s
      dialog already renders every attachment in a list, each with its own view/remove
      action, since a list of one and a list of several use the same code path. No
      additional implementation is needed for this story.)_

**Checkpoint**: User Stories 1 and 2 both work — multiple attachments per transaction are
already fully supported by Story 1's design.

---

## Phase 5: User Story 3 - Attachments Included in Backup/Export (Priority: P3)

**Goal**: A transaction's attachments survive a full backup-then-restore cycle, including
onto a different device.

**Independent Test**: Attach a receipt to a transaction, create a backup, wipe local data,
restore from the backup, and verify the attachment is present and viewable on the restored
transaction (per [quickstart.md](quickstart.md) Scenario 7).

### Tests for User Story 3 ⚠️

- [x] T012 [P] [US3] Extend the existing backup round-trip test (see
      `tests/unit/backupService.test.ts`) with a case covering `attachments`: create a
      transaction with an attachment, `createBackup`, wipe the database, `restoreBackup`,
      and confirm `AttachmentRepository.listForTransaction` returns the same attachment
      (`mimeType`, `data`, `sizeBytes` all intact) for the restored transaction id.

### Implementation for User Story 3

- [x] T013 [US3] Extend `src/data/io/backupService.ts` to include `attachments`: add
      `attachments: Attachment[]` to `BackupPayload.exportedEntities`, read/decrypt it in
      `collectPayload`, and add the matching encrypt/`db.transaction([...])`/`clear()`/
      `bulkPut()` steps in `restoreBackup` — follow the existing `transactionSplits` pattern
      exactly (research.md §6; keyed by `transactionId`, no independent soft-delete). Note:
      a separate background task is fixing this same file's pre-existing gap for
      `debtPlannerPreferences`/`savingsGoals`/`goalContributions`/`notificationPreferences`/
      `notifiedItems` — re-read the file's current state before editing rather than assuming
      the version described in research.md §6/data-model.md is exactly what's on disk.
      Depends on T007. Must make T012's test pass.
      _(The background task had already finished by the time this was implemented — schema
      was at `1.1.0` with `debtPlannerPreferences`/`savingsGoals`/`goalContributions`/
      `notificationPreferences`/`notifiedItems` already wired in. Bumped to `1.2.0`, added
      `migrations/v1_2.ts` as the new identity migration, and updated `migrateFromV1`/
      `migrateFromV1_1` to default `attachments: []` for older backups, following the exact
      pattern those two files already established.)_

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T014 [P] Write E2E test `tests/e2e/receiptAttachments.spec.ts` covering
      [quickstart.md](quickstart.md) Scenarios 1, 2, 4, 5, and 6 (attach/view/remove, reject
      unsupported/oversized files, soft-delete/restore keeps attachments, two independent
      attachments, permanent purge removes attachments). This is also the only place
      `compressImage`'s real canvas behavior is exercised (Scenario 3), since it needs a
      real browser.
      _(Since this project has no image-processing library (research.md §8), the test
      generates real, decodable JPEGs in-browser via canvas — a tiny one for tests that just
      need a valid attachment, and a high-resolution (3000x2000) gradient-plus-shapes one for
      the Scenario 3 compression check, since it exceeds the 1600px cap and forces real
      downscaling. All 3 tests pass via `npx playwright test
tests/e2e/receiptAttachments.spec.ts`.)_
- [x] T015 [P] Verify [quickstart.md](quickstart.md) Scenario 3 (a multi-megabyte photo
      compresses to well under 500KB and stays legible) and Scenario 7 (backup/restore,
      already covered by T012) against the actual UI/stored `sizeBytes` — Scenario 3 has no
      dedicated unit coverage since `compressImage` is browser-canvas-only; confirm it via
      the E2E test's attached file's resulting `sizeBytes`.
      _(T014's first test reads the stored thumbnail's `data:` URL `src` directly and asserts
      its decoded byte length is under 500KB after compressing the 3000x2000 fixture — this
      is the same bytes the app actually persists, since the `<img>` renders
      `AttachmentRepository`'s stored `data` field verbatim. Scenario 7 was already verified
      by T012's backup round-trip test.)_
- [x] T016 Review all new code against Constitution Principle III (`src/lib/
imageAttachment.ts` must have no dependents in `src/domain/`; `AttachmentRepository`
      and `TransactionRepository.purge` remain the only write paths for attachment data —
      no component calls Dexie directly) and Principle VI (`purge` is only reachable from an
      already-soft-deleted transaction and requires explicit confirmation in the UI; no
      `console.*` in any new file) before marking the feature complete.
      _(Verified: no file under `src/domain/` imports `imageAttachment.ts`; `db.attachments`
      is touched only by `attachmentRepository.ts` itself, `transactionRepository.ts`'s
      `purge` (which delegates the actual write to
      `AttachmentRepository.purgeForTransaction`), and `backupService.ts` (which reads/writes
      every entity table directly by established pattern, not specific to this feature); no
      component calls Dexie directly. `TransactionRepository.purge` throws unless the
      transaction is already soft-deleted, and `TrashPage.tsx`'s "Delete forever" action
      requires `window.confirm` before calling it. No `console.*` in any new file.)_

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on User Story 1 being complete (it is fully delivered
  by Story 1's design — no independent work).
- **User Story 3 (Phase 5)**: Depends on Foundational and on US1's `AttachmentRepository`
  (T007) only; independent of US2.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each Phase

- Tests MUST be written and confirmed failing before the implementation task(s) that follow
  them.
- Within Foundational: T002, T003 touch different files and can run in parallel.
- Within US1: T004 and T005 can run in parallel (different files); T006 depends only on
  Foundational; T007 depends on T002/T003; T008 depends on T007; T009 depends on T006/T007;
  T010 depends on T008.
- US3's T012/T013 can start any time after T007 (US1) is complete, independent of US1's
  later UI tasks (T009/T010) or US2.

### Parallel Opportunities

- Foundational: T002, T003 together.
- US1: T004, T005 together.
- Polish: T014, T015 together.
- US3 (T012-T013) can be worked in parallel with the tail end of US1 (T009-T010) once T007
  is done, since neither depends on the other.

---

## Parallel Example: Foundational Phase

```bash
Task: "Add Attachment interface to src/domain/entities.ts"
Task: "Add attachments table to src/data/dexie/db.ts"
```

## Parallel Example: User Story 1

```bash
Task: "Write failing unit tests in tests/unit/imageAttachment.test.ts"
Task: "Write failing integration tests in tests/integration/attachmentRepository.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (blocks everything else).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1, 2, 4, and 6 independently.
5. This alone delivers the spec's core value — attach, view, remove, and correct
   soft-delete/restore/purge lifecycle — before multi-attachment nuance or backup inclusion
   are separately verified.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → full attach/view/remove/purge lifecycle works.
3. User Story 2 → validate independently → already true by construction; just confirm it.
4. User Story 3 → validate independently → attachments survive backup/restore.
5. Polish → E2E coverage and a final Constitution compliance pass.

## Notes

- [P] tasks touch different files with no unmet dependency.
- Every task in a user-story phase carries that story's label for traceability.
- Commit after each task or logical group; verify a test fails before implementing against
  it, and passes immediately after.
- T013 touches a file another in-flight background task is also editing (research.md §6) —
  re-read `backupService.ts` fresh before editing it, don't assume its described shape is
  still exactly accurate.
