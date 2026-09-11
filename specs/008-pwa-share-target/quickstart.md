# Quickstart: Share-to-Quick-Add

Validation scenarios proving the feature works end-to-end, once implemented per
[plan.md](plan.md), [data-model.md](data-model.md), and
[contracts/share-target.md](contracts/share-target.md).

## Prerequisites

- App running locally (`npm run build && npm run preview`, since Web Share Target requires
  an installed PWA served over HTTPS or localhost — `npm run dev`'s dev server also works
  since `devOptions.enabled: true` is already set in `vite.config.ts`).
- The app installed to the home screen/app list on a real or emulated Android/Chromium
  device (Web Share Target is not exercised by desktop Chrome's own OS share menu in the
  same way — an Android device or emulator is the most reliable manual test target).
- Onboarding completed, at least one account created.

## Scenario 1 — Share text into Quick Add (User Story 1, manual OS-level check)

1. On the installed app, from any other app (e.g. Messages/Notes), select some
   payment-notification-style text, tap Share, and choose this app from the share sheet.
2. **Expect**: the app opens directly to Quick Add with that text already in the input and
   already parsed into a proposed transaction — no manual paste needed.
3. Compare against manually pasting the same text into Quick Add today.
4. **Expect**: identical parsed result (FR-002/SC-002).

## Scenario 2 — Text share survives a locked app (Acceptance Scenario 3 / FR-005)

1. Lock the app (or let it auto-lock).
2. Repeat Scenario 1's share action.
3. **Expect**: the app prompts for PIN/biometric unlock as normal; after unlocking, Quick
   Add appears with the shared text still present — not lost.

## Scenario 3 — Share an image into a new transaction (User Story 2)

1. From the device's photo gallery, share a receipt photo to this app.
2. **Expect**: the app opens a new-transaction entry screen with that image already shown
   as a pre-attached preview.
3. Fill in the remaining transaction details and save.
4. **Expect**: the saved transaction has that image as an attachment, viewable the same way
   any other attachment is (spec 005).

## Scenario 4 — Unsupported content is declined gracefully (Edge Case / FR-007)

1. Attempt to share a video file or unrelated document type to the app.
2. **Expect**: either the app does not appear as a valid share target for that content
   type, or, if it does receive it, it shows a clear "unsupported content" message rather
   than crashing or silently discarding it.

## Scenario 5 — No share support does not break anything (Edge Case / FR-007)

1. Open the app in a normal (non-installed) browser tab, or on a browser/OS without Web
   Share Target support (e.g. desktop Safari).
2. **Expect**: the app never appears as a share target there, and its existing manual
   paste/attach flows continue to work exactly as before — no error, no missing feature
   messaging.

## Scenario 6 — Blocked second instance does not lose a share (Edge Case / FR-006)

1. With the app already open in one tab/window, trigger a share (Scenario 1 or 3) that
   opens a second instance.
2. **Expect**: the existing single-instance `BlockedScreen` appears as it does today for
   any second instance; the user is directed to the original tab, and the shared content is
   not silently discarded (verify by then switching to the original tab and confirming the
   share URL/content is still retrievable rather than having vanished).

## Automated coverage

These scenarios correspond to:

- `tests/unit/shareTarget.test.ts` — `parseSharedText` boundary cases (empty/missing
  fields, `text`/`url`/`title` fallback order) using plain constructed field objects.
- `tests/e2e/shareTarget.spec.ts` — simulates the OS share by submitting a real POST
  navigation (a `<form method="POST" enctype="multipart/form-data" action="/share-target">`)
  — what the manifest's single `share_target` action always receives, and the only
  mechanism a differently-scoped service worker actually intercepts (research.md §2): once
  with only `text` fields (Scenario 1's app-side behavior, and Scenario 2 combined with a
  locked session) and once including a `file` part (Scenario 3's app-side behavior).
  Scenarios 1, 3, and 5's actual OS share-sheet interaction cannot be driven by Playwright
  and remain manual verification steps (above).
