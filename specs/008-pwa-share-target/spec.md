# Feature Specification: Share-to-Quick-Add

**Feature Branch**: `010-pwa-share-target`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "PWA share-target integration — register the app as a share
target on Android/iOS so a payment SMS/notification can be shared directly into Quick Add
instead of copy-pasted."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Share Text Directly into Quick Add (Priority: P1)

A user receives a payment notification/SMS on their phone, uses their device's native
"Share" action on it, selects this app from the share menu, and lands directly in Quick Add
with that text already loaded and parsed — skipping the copy-paste step entirely.

**Why this priority**: This is the entire feature — a faster on-ramp into the existing Quick
Add flow. Without this, the feature has no purpose.

**Independent Test**: From another app on an installed instance of this PWA, share a sample
payment-notification-style text to this app, and verify it opens directly to Quick Add with
that text pre-loaded and parsed exactly as if it had been pasted manually.

**Acceptance Scenarios**:

1. **Given** the app is installed on a supporting device, **When** the user shares text from
   another app and selects this app as the target, **Then** the app opens (or comes to the
   foreground) directly on the Quick Add screen with the shared text already in the input
   field.
2. **Given** shared text lands in Quick Add, **When** the app parses it, **Then** the
   resulting proposed transaction is identical to what pasting the same text manually would
   produce.
3. **Given** the app is locked (per the existing PIN-lock feature) when a share occurs,
   **When** the user completes unlocking, **Then** they land on Quick Add with the shared
   text still present, not lost.

---

### User Story 2 - Share an Image (Receipt) into a New Transaction (Priority: P2)

A user shares a photo (e.g., a receipt or a screenshot of a payment confirmation) from their
device's gallery directly into the app, landing on a new-transaction flow with that image
attached.

**Why this priority**: Extends the same share-target mechanism to images, but depends on the
receipt-attachment capability existing first, and is a secondary flow to the primary
text-sharing use case.

**Independent Test**: Share an image file to the app and verify it opens to a new-transaction
entry screen with that image already attached, ready for the user to fill in the remaining
details.

**Acceptance Scenarios**:

1. **Given** the app is installed and supports image attachments, **When** the user shares
   an image to it, **Then** the app opens a new-transaction entry screen with that image
   pre-attached.

---

### Edge Cases

- What happens when the app is not installed (only opened as a regular browser tab)? Share
  targeting is an installed-PWA capability; the app must not claim to support this in an
  uninstalled/browser-tab context, and the existing manual paste flow remains the fallback.
- What happens when the shared content is neither recognizable text nor a supported image
  type (e.g., a video or unrelated file)? The app must decline gracefully — either not
  appearing as a valid target for that content type, or showing a clear "unsupported content"
  message rather than crashing or silently discarding it.
- What happens when multiple items are shared at once (e.g., several images)? Each is
  processed as its own separate candidate entry, none silently dropped.
- What happens on a browser/OS combination that does not support the Web Share Target API at
  all? The app must not appear as a share option there and must not break normal operation;
  this is purely additive to the existing paste-based Quick Add.
- What happens if the app is opened via share while a second tab/window of the app is
  already open (per the existing single-instance restriction)? The existing block/read-only
  behavior for a second instance still applies; the shared content is not silently lost, and
  the user is directed to the original tab.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The installed app MUST register as an operating-system share target for plain
  text content.
- **FR-002**: When text is shared to the app, system MUST open directly to Quick Add with the
  shared text pre-loaded, producing an identical parse result to manually pasting the same
  text.
- **FR-003**: The installed app MUST register as a share target for supported image types.
- **FR-004**: When an image is shared to the app, system MUST open a new-transaction entry
  screen with that image pre-attached (depends on the receipt-attachment capability).
- **FR-005**: If the app is locked when content is shared, system MUST require normal unlock
  first, then present the shared content on the appropriate screen without loss.
- **FR-006**: If the app is opened via share while another instance is already open, the
  existing multi-instance block/read-only behavior MUST still apply, and the shared content
  MUST NOT be silently discarded.
- **FR-007**: On platforms/browsers that do not support share targeting, the app MUST
  continue to function normally via its existing manual paste/attach flows, with no error
  surfaced to the user for the absence of this capability.

### Key Entities

- No new persisted entities; this feature is an alternate entry path into the existing Quick
  Add (Transaction, reviewStatus=unreviewed) and Attachment flows.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can go from receiving a payment notification to a proposed, reviewable
  transaction in the app in under 10 seconds via share, versus the existing copy-paste flow.
- **SC-002**: 100% of text shared to the app produces the same parsed result as pasting that
  same text manually into Quick Add.
- **SC-003**: Zero crashes or lost content occur when sharing to a locked app instance, a
  second app instance, or an unsupported content type, across representative test cases.

## Assumptions

- This relies on browser/OS support for the Web Share Target API (available on modern
  Android/Chromium-based installed PWAs; iOS/Safari support is limited or absent at time of
  writing) — the feature degrades gracefully to the existing paste-based flow everywhere
  else, consistent with Constitution Principle V (no proprietary dependency required).
- Image sharing (Story 2) depends on the separate receipt-attachment feature already
  existing; if built first, Story 1 (text sharing) can ship independently.
