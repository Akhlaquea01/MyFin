---
description: 'Task list template for feature implementation'
---

# Tasks: Share-to-Quick-Add

**Input**: Design documents from `/specs/008-pwa-share-target/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/share-target.md](contracts/share-target.md),
[quickstart.md](quickstart.md)

**Tests**: Included, matching this repo's established convention (specs 001-007) even
though Constitution Principle IV's test-first mandate does not strictly apply here (no
money-affecting engine; see plan.md's Constitution Check) — `parseSharedText` is pure and
gets a Vitest unit test, and the harder-to-unit-test browser-API surface (service worker,
Cache API, real share POST) is covered by Playwright E2E instead.

**Organization**: Tasks are grouped by user story (spec.md priorities P1/P2).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1, US2)
- File paths below are real paths in this repository, following the conventions in
  `src/lib/imageAttachment.ts`/`src/lib/singleInstance.ts` (browser-API utility pattern)
  and `src/data/dexie/attachmentRepository.ts` (the spec 005 code this feature reuses for
  Story 2).

---

## Phase 1: Setup

**Purpose**: Establish a clean baseline before touching any code

- [ ] T001 Confirm no new npm dependency is required (per [research.md](research.md) §6 —
      native Web Share Target manifest field, Service Worker/Cache/`URLSearchParams` APIs,
      and the existing `imageAttachment.ts`/`AttachmentRepository` only) and run the
      existing test suite (`npm run test`) to confirm it passes cleanly before starting.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The single manifest declaration both stories share — the platform allows only
one `share_target`, so it must be declared once, upfront, with both text and file mappings
(research.md §2)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T002 [P] Add a `share_target` entry to the `VitePWA({ manifest: {...} })` call in
      `vite.config.ts` per [contracts/share-target.md](contracts/share-target.md): `action:
      "/share-target"`, `method: "POST"`, `enctype: "multipart/form-data"`, `params: {
      title: "title", text: "text", url: "url", files: [{ name: "file", accept: ["image/*"]
      }] }`. This field is not part of `vite-plugin-pwa`'s narrower manifest TS type, so add
      it via a type-safe spread/cast rather than `as any` on the whole config object.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Share Text Directly into Quick Add (Priority: P1) 🎯 MVP

**Goal**: A payment SMS/notification shared from another app lands the user directly on
Quick Add with that text already loaded and parsed — identical to pasting it manually.

**Independent Test**: POST a `multipart/form-data` body with only a `text` field to
`/share-target` (simulating the OS share) and verify the app redirects to Quick Add with
that text pre-loaded and parsed exactly as manual paste would produce (per
[quickstart.md](quickstart.md) Scenarios 1 and 2).

### Tests for User Story 1 ⚠️

> Write these tests FIRST; confirm they fail before writing the implementation.

- [ ] T003 [P] [US1] Write failing unit tests in `tests/unit/shareTarget.test.ts` for
      `parseSharedText(fields)`: returns `text` when present; falls back to `url` when
      `text` is empty/absent; falls back to `title` when both are empty/absent; returns
      `null` when all three are empty/absent (research.md §4).
- [ ] T004 [P] [US1] Write a failing E2E test in `tests/e2e/shareTarget.spec.ts`: load the
      installed app once (so its service workers register/activate), then from the page
      context `fetch('/share-target', { method: 'POST', body: <FormData with only a text
      field> })` and assert the resulting navigation lands on Quick Add with that text
      already in the input and already parsed into a proposed transaction identical to
      pasting the same text manually ([quickstart.md](quickstart.md) Scenario 1). Add a
      second case that locks the app first (per the existing PIN-lock feature), repeats the
      share, unlocks, and confirms the shared text is still present afterward
      ([quickstart.md](quickstart.md) Scenario 2, FR-005).

### Implementation for User Story 1

- [ ] T005 [US1] Implement `parseSharedText(fields: { text?: string; url?: string; title?:
      string }): string | null` in `src/lib/shareTarget.ts` per
      [contracts/share-target.md](contracts/share-target.md): returns `text`, falling back
      to `url`, then `title`, or `null`. Depends on Foundational only. Must make T003's
      tests pass.
- [ ] T006 [US1] In the same file, implement `readAndClearSharedPayload(id: string):
      Promise<{ sharedText: string | null; file: File | null }>`: opens the
      `share-target-buffer` Cache, reads the `meta:<id>` JSON entry (`{ sharedText }`),
      deletes it, and returns `{ sharedText, file: null }` (the `file:<id>` lookup is added
      in User Story 2, T014). Depends on T005 (same file — implement sequentially, not in
      parallel).
- [ ] T007 [US1] Create `src/sw-share-target.ts`: a `fetch` event handler that matches only
      `POST` requests whose URL path is `/share-target`; reads the request's
      `multipart/form-data` via `request.formData()`, extracts `text`/`url`/`title` string
      fields, calls `parseSharedText`, generates `crypto.randomUUID()`, `put`s a JSON
      `Response` of `{ sharedText }` into the `share-target-buffer` Cache under
      `meta:<id>`, and responds with a `303` redirect to
      `/share-target-landing?id=<id>`. Any non-matching request falls through untouched (no
      `event.respondWith`). Depends on T005/T006.
- [ ] T008 [US1] In `src/App.tsx`, register the new service worker once on mount:
      `navigator.serviceWorker.register('/sw-share-target.js', { scope: '/share-target/'
      })`, alongside (not replacing) the existing `vite-plugin-pwa`-managed registration.
      Depends on T007.
- [ ] T009 [US1] Create `src/pages/ShareTargetLandingPage.tsx`: on mount, reads the `id`
      query param via `useSearchParams()`, calls `readAndClearSharedPayload(id)`, and once
      resolved: if `sharedText` is present, `navigate('/quick-add', { replace: true, state:
      { sharedText } })`; otherwise `navigate('/quick-add', { replace: true })` with no
      state and a `toast` explaining the shared content could not be retrieved (Edge Case).
      Renders only a brief loading state. Depends on T006.
- [ ] T010 [US1] Add `<Route path="share-target-landing" element={<ShareTargetLandingPage
      />} />` to the `<Routes>` in `src/App.tsx` (outside the `<AppShell />`-wrapped route
      group, since this route is a pure redirect with no shell UI of its own — mirror how
      other top-level routes are structured). Depends on T009.
- [ ] T011 [US1] Extend `src/pages/QuickAddPage.tsx`: add a `useEffect` that reads
      `useLocation().state?.sharedText` once on mount; if present, set `rawText` to it and
      immediately invoke the same parse logic the existing "Parse" button triggers (FR-002).
      No other change to this page's existing behavior. Depends on T010.

**Checkpoint**: User Story 1 is fully functional and independently testable — sharing text
lands the user on a pre-parsed Quick Add screen, surviving a lock-screen interruption.

---

## Phase 4: User Story 2 - Share an Image (Receipt) into a New Transaction (Priority: P2)

**Goal**: A receipt photo shared from the gallery lands the user on a new-transaction
screen with that image already attached, reusing spec 005's existing attachment pipeline.

**Independent Test**: POST a `multipart/form-data` body including a `file` field to
`/share-target` and verify the app redirects to a new-transaction screen with that image
pre-attached, and that saving the transaction stores it as a real `Attachment` (per
[quickstart.md](quickstart.md) Scenario 3).

### Tests for User Story 2 ⚠️

- [ ] T012 [P] [US2] Extend `tests/e2e/shareTarget.spec.ts` with a case that generates a
      real, decodable JPEG in-browser via canvas (same technique as
      `tests/e2e/receiptAttachments.spec.ts`), POSTs it as the `file` field alongside
      `multipart/form-data` to `/share-target`, and asserts: the app redirects to
      `/transactions/new` with that image shown as a pre-attached preview; after filling in
      the remaining required fields and saving, the resulting transaction has exactly one
      `Attachment` (verify via `AttachmentRepository.listForTransaction`, per
      [quickstart.md](quickstart.md) Scenario 3).

### Implementation for User Story 2

- [ ] T013 [US2] Extend `src/sw-share-target.ts`'s fetch handler: also read the `file` field
      from the `formData` (if present), and if present, `put` a `Response(file)` into the
      `share-target-buffer` Cache under `file:<id>` (same `id` used for `meta:<id>`) before
      issuing the same `303` redirect. Depends on T007.
- [ ] T014 [US2] Extend `readAndClearSharedPayload` in `src/lib/shareTarget.ts`: also read
      the `file:<id>` Cache entry (if present), delete it alongside `meta:<id>`, and return
      it as `file: File | null` in the resolved payload. Depends on T006.
- [ ] T015 [US2] Extend `src/pages/ShareTargetLandingPage.tsx`: when the resolved payload's
      `file` is present, `navigate('/transactions/new', { replace: true, state: {
      sharedFile: file } })` instead of routing to Quick Add — file takes priority over
      `sharedText` per FR-004. Depends on T009, T014.
- [ ] T016 [US2] Extend `src/pages/NewTransactionPage.tsx`: read `useLocation().state
      ?.sharedFile` once on mount; if present, render a small preview (thumbnail + filename)
      above the existing form. On successful save (after the existing `TransactionEngine`
      call creates the `Transaction`), call `validateAttachmentFile(sharedFile)` — if valid,
      `compressImage` then `AttachmentRepository.create(key, { transactionId:
      newTransaction.id, ...compressed })` (spec 005's existing functions/repository,
      imported directly — no new logic); if invalid, the transaction still saves and a
      `toast` explains only the image could not be attached (Edge Case: unsupported content
      does not block the save). Depends on T015.

**Checkpoint**: User Stories 1 and 2 both work independently — text shares reach a
pre-parsed Quick Add, image shares reach a pre-attached new transaction that saves a real
`Attachment` via the exact spec 005 pipeline.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [ ] T017 [P] Verify [quickstart.md](quickstart.md) Scenario 6 (FR-006): with the app
      already open in one tab, trigger a share that opens a second instance, and confirm
      the existing single-instance `BlockedScreen` appears exactly as it does for any other
      route today, and that switching back to the original tab still shows the share URL
      resolvable (not silently discarded). No new code expected — this verifies the
      by-construction guarantee from [research.md](research.md) §1.
- [ ] T018 [P] Verify [quickstart.md](quickstart.md) Scenarios 4 and 5 (FR-007): sharing an
      unsupported content type (e.g. a video) does not crash the app or lose data, and
      opening the app in a browser/OS without Web Share Target support (e.g. desktop
      Safari, or an uninstalled tab) leaves every existing manual paste/attach flow working
      exactly as before, with the app never appearing as a share target there.
- [ ] T019 Review all new/changed files against Constitution Principle I (`src/sw-share-
      target.ts` never sends shared content to any network endpoint — only reads/writes the
      local Cache API and redirects), Principle II (the `share-target-buffer` Cache entries
      are deleted in the same call that reads them — no lingering unencrypted copy; no
      `console.*` logging of shared content in any new file), and Principle III
      (`src/lib/shareTarget.ts` has no dependents in `src/domain/`; `NewTransactionPage.tsx`
      calls only the existing `AttachmentRepository`/`imageAttachment.ts` functions, never
      Dexie directly) before marking the feature complete.
- [ ] T020 Run the full [quickstart.md](quickstart.md) scenario list manually on an
      installed Android/Chromium PWA (real OS share sheet, not simulated), since the actual
      share-sheet interaction cannot be automated (research.md §1 notes; plan.md Testing).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational only.
- **User Story 2 (Phase 4)**: Depends on Foundational; extends four of the same files User
  Story 1 created (`sw-share-target.ts`, `shareTarget.ts`, `ShareTargetLandingPage.tsx`), so
  in practice it starts after User Story 1's implementation tasks (T007-T009) land, even
  though its own *goal* (image share) is independently testable and deliverable once done.
- **Polish (Phase 5)**: Depends on both user stories being complete.

### Within Each Phase

- Tests MUST be written and confirmed failing before the implementation task(s) that follow
  them.
- Within US1: T003 and T004 can run in parallel (different files). T005 and T006 touch the
  same file (`shareTarget.ts`) and must be done sequentially, not in parallel. T007 depends
  on T005/T006; T008 depends on T007; T009 depends on T006; T010 depends on T009; T011
  depends on T010.
- Within US2: T012 extends the same E2E file T004 created — write it after T004 exists, but
  it can be written (and confirmed failing) before US2's implementation tasks. T013 extends
  the same file as T007; T014 extends the same file as T005/T006; T015 depends on T009 and
  T014; T016 depends on T015.

### Parallel Opportunities

- US1: T003, T004 together (different files).
- Polish: T017, T018 together (independent verification passes, no shared file edits).

---

## Parallel Example: User Story 1

```bash
Task: "Write failing unit tests in tests/unit/shareTarget.test.ts"
Task: "Write a failing E2E test in tests/e2e/shareTarget.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (the one-time manifest declaration).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1 and 2 independently.
5. This alone delivers the spec's higher-priority value — share text straight into a
   pre-parsed Quick Add — before the image-share/attachment path is built.

### Incremental Delivery

1. Setup + Foundational → the single manifest declaration is in place.
2. User Story 1 → validate independently → text share reaches pre-parsed Quick Add, even
   through a lock-screen interruption.
3. User Story 2 → validate independently → image share reaches a pre-attached new
   transaction, saved as a real attachment via spec 005's pipeline.
4. Polish → confirm the existing lock/single-instance/unsupported-browser behaviors hold
   unchanged, then a final Constitution compliance pass.

## Notes

- [P] tasks touch different files with no unmet dependency.
- Every task in a user-story phase carries that story's label for traceability.
- Commit after each task or logical group; verify a test fails before implementing against
  it, and passes immediately after.
- T007/T013 and T005/T006/T014 are the same two files touched across both stories by
  design (research.md §2/§3: one manifest target, one service worker, one utility module,
  shared by both content types) — re-read each file's current state before extending it in
  Phase 4 rather than assuming Phase 3 left it in exactly the shape described above.
