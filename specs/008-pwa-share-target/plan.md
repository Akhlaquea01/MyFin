# Implementation Plan: Share-to-Quick-Add

**Branch**: `008-pwa-share-target` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-pwa-share-target/spec.md`

## Summary

Register the installed PWA as an OS-level share target so a payment SMS/notification
(text) or a receipt photo (image) shared from another app lands directly in this app's
existing entry flows — Quick Add for text, a pre-attached new transaction for images —
instead of requiring manual copy-paste. Technical approach: a single `share_target` entry
added to the Web App Manifest (the platform allows only one, so text and file shares both
POST to it — research.md §2), a narrow-scope service worker that intercepts that POST and
stashes the payload in the Cache API, and one new thin landing route that reads the
stashed payload and redirects into the existing `QuickAddPage`/`NewTransactionPage` with it
pre-loaded. No new persisted entity, no backend, and no change to the existing
lock/single-instance gating — both are satisfied for free because the redirect URL
survives underneath the lock screen and `BlockedScreen` exactly like any other URL does
today.

## Technical Context

**Language/Version**: TypeScript 5.x, same evergreen-browser target as the core app (Vite)

**Primary Dependencies**: No new npm dependency. Reuses React 19 + React Router (one new
route), the existing `src/lib/imageAttachment.ts` (`validateAttachmentFile`,
`compressImage`) and `AttachmentRepository` from spec 005, and `vite-plugin-pwa`'s
`manifest` pass-through for the new, single `share_target` field (the platform allows only
one, so it covers both text and file shares — research.md §2). Also requires one small,
additional hand-written service worker file registered at a narrow scope to intercept that
field's POST action (research.md §2) — `vite-plugin-pwa`'s existing `generateSW`-managed
service worker is left untouched.

**Storage**: No new IndexedDB table. The share hand-off uses the browser's Cache API as a
purely transient buffer between the share-target service worker and the page that consumes
it — written once, read once, deleted immediately after (research.md §2); nothing here is
"storage" in the persisted-entity sense the constitution's data-integrity principle governs.

**Testing**: Vitest unit tests for the pure text-field-resolution helper
(`parseSharedText`); a Playwright E2E test that submits a real POST navigation (a
`<form method="POST" enctype="multipart/form-data" action="/share-target">`) against the
running preview server — the same mechanism a real OS share triggers, and the only one a
differently-scoped service worker actually intercepts (a subresource `fetch()` from an
uncontrolled page would not be — research.md §2) — for both a text-only payload and a
payload including an image. A real OS share sheet cannot be driven from Playwright or
Vitest, so that end of the flow is documented as a manual verification step in
quickstart.md rather than automated.

**Target Platform**: Same installable PWA (Android/iOS/desktop). Web Share Target is
supported on installed PWAs on Android/Chromium-based browsers; iOS/Safari does not support
it at time of writing. Per spec Assumptions, this is additive only — unsupported
browsers simply never see the app offered as a share target, with zero change to existing
behavior (Constitution Principle V's "no proprietary dependency required" spirit).

**Project Type**: Web — single frontend-only project (no backend exists or is planned)

**Performance Goals**: Share-to-visible-Quick-Add transition must feel instantaneous (SC-001:
under 10 seconds end-to-end, which is dominated by the OS share-sheet interaction itself,
not app code) — the app-side redirect and parse are synchronous/near-instant operations
already proven by the existing paste-based Quick Add flow.

**Constraints**: Must not require any server component (Principle I) — the POST image
hand-off is intercepted entirely client-side by a service worker, never sent to a real
backend. Must not persist shared content unencrypted (Principle II) — the Cache API buffer
used for the image hand-off holds the same kind of transient, not-yet-committed browser
data the OS clipboard already holds for the existing paste flow, and is cleared as soon as
it's read; nothing shared is written to IndexedDB until the user actually saves the
resulting transaction, at which point it goes through the exact same encrypted path as
every other entity. Must not break the existing lock screen or single-instance gating
(FR-005/FR-006) — verified by construction in research.md §1, not by new gating code.

**Scale/Scope**: Single user per installation; 2 prioritized user stories, 7 functional
requirements (see [spec.md](spec.md)).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Check | Status |
| --- | --- | --- |
| I. Local-First & Zero-Server | Share handling is entirely client-side: a manifest declaration, a service worker fetch handler, and two page routes. No network call, no server, no cloud sync introduced. | PASS |
| II. Privacy & Encryption by Default | Shared text flows through the exact same `parseQuickAddText`/Quick Add save path as manual paste — no new plaintext storage. Shared images flow through the existing `validateAttachmentFile`/`compressImage`/`AttachmentRepository.create` path (spec 005) once the user saves the transaction — encrypted exactly like every other attachment. The Cache API hand-off buffer (research.md §2) is transient, unencrypted-at-rest browser cache, not a persisted financial record; it is cleared immediately after being read, bounding exposure to the moment between the OS share and the app reading it. | PASS |
| III. Layered Clean Architecture | New `src/lib/shareTarget.ts` (browser-API utility: query-string parsing, Cache API read/clear) sits in `lib/` alongside `imageAttachment.ts`/`singleInstance.ts` — no domain logic, no direct Dexie access. `NewTransactionPage.tsx` gains a call to the existing `AttachmentRepository.create` after saving, the same call `TransactionsPage.tsx` already makes (spec 005) — no new dependency direction. | PASS |
| IV. Test-First for Financial Logic | N/A — this is an entry-point/routing feature; it introduces no financial calculation and touches no money-affecting engine. | N/A |
| V. Free & Open-Source Only | No new npm dependency. The additional service worker file is hand-written using only the standard Service Worker/Cache APIs already available in every target browser. | PASS |
| VI. Data Integrity & Non-Destructive Operations | No new entity, no new deletion semantics. Images shared in are attached via the existing `AttachmentRepository.create`, which already enforces the 5-attachment cap and integer `sizeBytes` (spec 005); nothing here weakens that. | PASS |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/share-target.md, quickstart.md):

- `contracts/share-target.md` confirms `src/lib/shareTarget.ts` is the only place that reads
  the Cache API hand-off buffer, and that it is deleted in the same call that reads it — no
  lingering unencrypted copy, keeping Principle II intact.
- `data-model.md` confirms no new Dexie table or entity is introduced; the one schema-
  adjacent change is `NewTransactionPage.tsx` optionally calling the existing
  `AttachmentRepository.create` after transaction save, already governed by spec 005's
  validation and cap rules — Principle VI intact.
- No new dependency appears anywhere in data-model.md or the contract — Principle V intact.
- Re-confirmed (not just asserted) that FR-005/FR-006 need no new gating code: `App.tsx`
  renders `<LockScreen>`/`<BlockedScreen>` *before* mounting `<BrowserRouter>`, so the
  browser's own URL bar — which already holds the share-target URL and its query
  params/hand-off id at that point — is exactly what `BrowserRouter` reads once it finally
  mounts post-unlock/post-block. This is an existing property of `App.tsx`, not new code
  this feature adds.

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/008-pwa-share-target/
├── plan.md                    # This file (/speckit-plan command output)
├── research.md                # Phase 0 output (/speckit-plan command)
├── data-model.md              # Phase 1 output (/speckit-plan command)
├── quickstart.md              # Phase 1 output (/speckit-plan command)
├── contracts/                 # Phase 1 output (/speckit-plan command)
│   └── share-target.md
└── tasks.md                   # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── lib/
│   └── shareTarget.ts              # NEW: parseSharedText(), readAndClearSharedPayload()
│                                       (browser-API utility, research.md §2-4)
│
├── pages/
│   ├── ShareTargetLandingPage.tsx  # NEW: single landing route after the POST hand-off —
│   │                                   reads the stashed payload, redirects into Quick Add
│   │                                   (text) or a new transaction (file pre-attached)
│   ├── QuickAddPage.tsx            # EXTENDED: accepts pre-loaded shared text via router
│   │                                   state, otherwise unchanged
│   └── NewTransactionPage.tsx      # EXTENDED: optional pre-attached image preview + a
│                                       post-save AttachmentRepository.create call
│                                       (only exercised when arriving via share)
│
└── App.tsx                         # EXTENDED: one new route (share-target-landing);
                                        registers /sw-share-target.js alongside the
                                        existing vite-plugin-pwa registration

public/
└── sw-share-target.js              # NEW: minimal hand-written service worker (plain JS,
                                        not compiled — research.md §2), registered at scope
                                        "/share-target", handling the single POST
                                        share-target hand-off (text and/or file)

vite.config.ts                      # EXTENDED: VitePWA `manifest.share_target` entry

tests/
├── unit/
│   └── shareTarget.test.ts         # NEW: parseSharedText() boundary cases
└── e2e/
    └── shareTarget.spec.ts         # NEW: POST text-only and POST with-file share
                                        simulation (via a submitted form navigation, not
                                        fetch() — research.md §2), locked/blocked-instance
                                        interaction
```

**Structure Decision**: Extends the existing single frontend-only project layout unchanged
(see [../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)'s
Structure Decision, reused as-is by specs 002-007). This feature adds one new browser-API
utility module, one small standalone plain-JS service worker file (in `public/`, not
compiled), and one new thin routing page, and extends three existing files
(`QuickAddPage.tsx`, `NewTransactionPage.tsx`, `App.tsx`) plus `vite.config.ts` — no new
architectural layer, no new project.
