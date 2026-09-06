# Quickstart: Receipt & Photo Attachments

Validation scenarios proving the feature works end-to-end, once implemented per
[plan.md](plan.md), [data-model.md](data-model.md), and
[contracts/attachment-service.md](contracts/attachment-service.md).

## Prerequisites

- App running locally (`npm run dev`) with onboarding completed and at least one
  transaction already recorded.

## Scenario 1 — Attach, view, and remove a receipt (User Story 1)

1. Open Transactions, open the "Attachments" action on an existing transaction's row.
2. Attach a JPEG image file.
3. **Expect**: the transaction's row now shows an attachment indicator; the dialog shows a
   thumbnail; clicking it opens the image full-size.
4. Remove the attachment.
5. **Expect**: it disappears from the dialog and the row's indicator clears.

## Scenario 2 — Rejects an unsupported file or oversized file (Acceptance Scenario 4 / FR-004)

1. Attempt to attach a `.pdf` file.
2. **Expect**: a clear rejection message; nothing is stored.
3. Attempt to attach an image file larger than the raw-input cap (20MB).
4. **Expect**: the same kind of clear rejection; nothing is stored.

## Scenario 3 — Large photo is compressed (FR-005 / SC-003)

1. Attach a multi-megabyte phone-camera-resolution JPEG.
2. **Expect**: the stored attachment (check `sizeBytes`, or the dialog's displayed size) is
   well under 500KB, and the image remains legible when viewed full-size.

## Scenario 4 — Soft-delete/restore keeps attachments (Acceptance Scenario 3)

1. On a transaction with an attachment, delete the transaction (moves to Trash).
2. Open Trash, restore the transaction.
3. **Expect**: reopening its Attachments dialog shows the same attachment, unaffected.

## Scenario 5 — Multiple attachments per transaction (User Story 2)

1. Attach a second image to the same transaction.
2. **Expect**: both are listed, independently viewable and independently removable; removing
   one leaves the other intact.
3. Attempt to attach a 6th image.
4. **Expect**: rejected with a clear message (research.md §7's 5-attachment cap).

## Scenario 6 — Permanent purge removes attachments too (Edge Case / FR-006 / SC-004)

1. On a transaction with an attachment, delete it (Trash), then use Trash's new "Delete
   forever" action for that transaction (research.md §5).
2. **Expect**: the transaction is gone from Trash entirely (not just hidden), and its
   attachment data is gone from storage — inspect via
   `AttachmentRepository.listForTransaction` returning `[]` for that (now-nonexistent)
   transaction id, or via the integration test's direct table check.

## Scenario 7 — Attachments survive backup/restore (User Story 3)

1. With a transaction that has an attachment, create a full encrypted backup.
2. Wipe local data (or restore onto a fresh profile) and restore from that backup.
3. **Expect**: the transaction's attachment is present and viewable exactly as before.

## Automated coverage

These scenarios correspond to:

- `tests/unit/imageAttachment.test.ts` — `validateAttachmentFile` boundary cases (Scenario 2) using constructed `File` objects; `compressImage` is browser-canvas-dependent and is
  instead covered by the E2E suite (Scenario 3).
- `tests/integration/attachmentRepository.test.ts` — the 5-attachment cap (Scenario 5),
  `TransactionRepository.purge`'s cascade (Scenario 6), and the backup/restore round trip
  including the `attachments` table (Scenario 7).
- `tests/e2e/receiptAttachments.spec.ts` — Scenarios 1, 2, 4, 5, 6 end-to-end through the UI.
