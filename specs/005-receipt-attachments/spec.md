# Feature Specification: Receipt & Photo Attachments

**Feature Branch**: `005-receipt-attachments`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "Receipt/photo attachments — attach a photo (stored as an
encrypted blob in IndexedDB, same crypto layer as everything else) to a transaction for
record-keeping."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Attach a Receipt to a Transaction (Priority: P1)

A user recording or editing a transaction attaches a photo of the receipt (taken with their
camera or chosen from their device), and can later view it from the transaction.

**Why this priority**: This is the entire feature — attaching and later viewing an image is
the whole value proposition.

**Independent Test**: Create a transaction, attach an image file to it, reopen the
transaction later, and verify the same image displays correctly.

**Acceptance Scenarios**:

1. **Given** an existing transaction, **When** the user attaches a photo to it, **Then** the
   transaction shows an indicator that an attachment exists and the image can be opened/
   viewed full-size.
2. **Given** a transaction with an attachment, **When** the user removes the attachment,
   **Then** it is no longer shown or retrievable from that transaction.
3. **Given** a transaction with an attachment, **When** the user deletes the transaction
   (soft delete) and later restores it from trash, **Then** the attachment is restored along
   with it.
4. **Given** the user attempts to attach a file that is not a supported image type or
   exceeds the size limit, **When** they select it, **Then** the app rejects it with a clear
   message rather than silently failing or corrupting storage.

---

### User Story 2 - Multiple Attachments per Transaction (Priority: P2)

A user attaches more than one photo to a single transaction (e.g., a receipt front and
back, or a receipt plus a warranty card).

**Why this priority**: Common real-world need, but the feature is already useful with a
single attachment per transaction from Story 1.

**Independent Test**: Attach two images to the same transaction and verify both are stored
and independently viewable/removable.

**Acceptance Scenarios**:

1. **Given** a transaction with one attachment, **When** the user adds a second, **Then**
   both are listed and can be viewed or removed independently of each other.

---

### User Story 3 - Attachments Included in Backup/Export (Priority: P3)

A user backs up their data (per the existing backup/restore feature) and their receipt
attachments are included, so restoring on another device brings the images back too.

**Why this priority**: Without this, attachments would silently not survive the app's
existing disaster-recovery path, undermining trust in both features; still a distinct,
separately testable slice from simply attaching and viewing.

**Independent Test**: Attach a receipt to a transaction, create a backup, wipe local data,
restore from the backup, and verify the attachment is present and viewable on the restored
transaction.

**Acceptance Scenarios**:

1. **Given** transactions with attachments, **When** the user creates a backup, **Then** the
   attachment images are included in the encrypted backup.
2. **Given** a backup containing attachments, **When** it is restored, **Then** each
   transaction's attachments are restored intact and viewable.

---

### Edge Cases

- What happens when the user's device is low on storage and an attachment can't be saved?
  The app must reject the attach action with a clear message and must not leave the
  transaction or storage in a corrupted/partial state.
- What happens when an account/device does not have a camera (desktop without one)? The user
  can still attach an existing image file from disk.
- What happens to attachments when a transaction is permanently purged from trash (not just
  soft-deleted)? Attachments must be permanently deleted at the same time, not left as
  orphaned data.
- What happens when the same image is attached to a transaction that gets split across
  multiple categories? The attachment stays associated with the parent transaction, not
  each split.
- What happens when a very large image (e.g., a full-resolution phone camera photo) is
  attached? The app should downscale/compress it to a reasonable size to avoid bloating
  local storage and backups, while remaining legible.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Users MUST be able to attach one or more image files to a transaction, either
  by capturing a new photo (on supporting devices) or selecting an existing image file.
- **FR-002**: System MUST encrypt attachment data at rest using the same encryption scheme
  as all other financial data (Constitution Principle II) — no attachment may be stored or
  transmitted in plaintext.
- **FR-003**: Users MUST be able to view an attachment full-size and remove it from a
  transaction.
- **FR-004**: System MUST reject attachment files that are not a supported image type or
  exceed a defined maximum size, with a clear error message.
- **FR-005**: System MUST compress/downscale attached images above a defined resolution
  threshold before storing them, to bound local storage usage.
- **FR-006**: When a transaction is soft-deleted and later restored, its attachments MUST be
  restored along with it; when a transaction is permanently purged, its attachments MUST be
  permanently deleted at the same time.
- **FR-007**: System MUST include attachment data in encrypted backups, and MUST restore
  attachments intact when a backup is restored.
- **FR-008**: System MUST support at least a reasonable number of attachments per
  transaction (not hard-capped at one).

### Key Entities

- **Attachment**: Binary image data (stored encrypted) linked to a single Transaction, with
  a filename/label, size, and creation timestamp; soft-deleted/restored/purged in lockstep
  with its parent transaction.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can attach a photo to a transaction and view it again in under 15
  seconds total.
- **SC-002**: 100% of attachments survive a full backup-then-restore cycle, including onto a
  different device, matching the existing backup/restore guarantee for other data.
- **SC-003**: Attaching a typical phone-camera photo (several megabytes) results in stored
  size reduced to a bounded target (e.g., under 500KB) without the image becoming illegible.
- **SC-004**: Zero orphaned attachment data remains after a transaction is permanently
  purged, verified by storage inspection.

## Assumptions

- Attachments are images only (JPEG/PNG/WebP or camera capture); PDF or other document
  types are out of scope for this version.
- A reasonable per-transaction attachment count limit (e.g., up to 5) is enforced to keep
  local storage and backup size predictable; exact limit is a design detail, not a
  user-facing constraint worth specifying further here.
- Local storage capacity is the limiting factor (no server), consistent with Constitution
  Principle I; users are already warned separately about durable-storage risk (existing
  FR-044).
