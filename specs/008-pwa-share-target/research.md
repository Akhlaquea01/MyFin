# Phase 0 Research: Share-to-Quick-Add

## 1. The lock screen and single-instance block already preserve a share URL for free

**Decision**: Rely on `App.tsx`'s existing structure rather than adding any new
"remember the shared content across unlock" logic: `App.tsx` returns `<LockScreen>` (when
locked) or `<BlockedScreen>` (when `role === 'secondary'`) *before* `<BrowserRouter>` is
ever mounted (`src/App.tsx` lines ~131-138). Neither of those early returns touches
`window.location` — the browser's own address bar keeps whatever URL the share-target
service worker redirected to (`/share-target-landing?id=...`, research.md §2) the entire
time the user is looking at the lock screen or the blocked screen. Once the user unlocks (or
switches to the primary tab), `<BrowserRouter>` mounts and reads that same, unchanged URL,
so React Router matches the share-target route exactly as if no lock/block had ever
happened.

**Rationale**: FR-005 ("shared content must not be lost across an unlock") and FR-006
("shared content must not be silently discarded when blocked by the single-instance
check") are both satisfied by a property `App.tsx` already has today, for every route, not
something specific to this feature. Adding a parallel "stash the pending share in
`sessionStorage` and replay it after unlock" mechanism would duplicate what the URL bar
already does for free and would be extra state to keep in sync — real surface area for the
exact class of bug ("shared content silently lost") these requirements exist to prevent.

**Alternatives considered**: Storing the pending share in `sessionStorage`/a React context
before rendering the lock screen, then replaying it after unlock — rejected as unnecessary
complexity; it would need to handle the same "what if the tab is closed and reopened"
edge case the URL bar already handles natively via normal browser history/reload behavior.

## 2. One `share_target`, not two — text and file share both go through one POST action

**Decision**: The Web App Manifest spec allows exactly **one** `share_target` member per
manifest (a single object, not a list) — there is no way to register a separate GET action
for text and a separate POST action for files. Since file shares (Story 2) *require*
`method: "POST"`/`enctype: "multipart/form-data"` (a GET URL cannot carry file bytes), the
single registered target uses POST for everything, with `params` mapping `title`/`text`/
`url` (sent as ordinary multipart fields whenever a share includes no file) alongside a
`files` mapping (for image shares). One small, hand-written service worker
(`src/sw-share-target.ts`), registered at a narrow scope (e.g. `/share-target/`), intercepts
`fetch` events for the single POST action URL (`/share-target`): it reads the
`multipart/form-data` body for whichever fields are present (`text`/`title`/`url` and/or a
`file`), stashes them under one `Cache` entry keyed by a generated id (research.md's
data-model documents the exact shape), and responds with a redirect to
`/share-target-landing?id=<id>`. `src/lib/shareTarget.ts` exposes
`readAndClearSharedPayload(id)`, called once by the single `ShareTargetLandingPage.tsx` on
mount, which reads that entry and deletes it in the same call — so the hand-off buffer never
outlives a single read.

This new service worker is registered **independently** of the one `vite-plugin-pwa`
already generates and registers for offline asset caching (`registerType: 'autoUpdate'` in
`vite.config.ts`). Because its scope (`/share-target/`) is more specific than the root SW's
scope (`/`), it — and only it — controls fetch events under `/share-target/`, leaving the
existing offline-caching service worker and its `generateSW` pipeline completely untouched.

**Rationale**: Keeps Constitution Principle I intact (no server ever receives the shared
content; the "POST" never leaves the device) using only standard Service Worker/Cache APIs
already available in every target browser — no new dependency (Principle V). A single POST
target also means Story 1 (text) and Story 2 (files) share the exact same interception
mechanism rather than needing two, which is simpler than the two-target design this
research originally sketched (superseded here) and is consistent with how real-world Web
Share Target implementations are built, since the platform gives no other choice once any
file support is needed.

**Alternatives considered**: A GET-based target for text only, with file support declared
separately — rejected; not expressible in a single manifest (the platform constraint, not a
design preference). Switching the whole app to `vite-plugin-pwa`'s `injectManifest` strategy
just to add this one handler — rejected; it would require re-deriving the precaching setup
`generateSW` currently generates automatically, a much larger diff and regression risk for
the existing, already-shipped offline behavior, for a feature that only needs one narrow
additional capability.

## 3. Text-only shares still go through the same POST target — no separate code path

**Decision**: Because Story 1 and Story 2 share one manifest `share_target`, a text-only
share (no image) is *also* a POST carrying just the `text`/`title`/`url` fields with no
`file` field. The service worker and `ShareTargetLandingPage.tsx` handle this as simply the
case where the stashed payload has no file: `readAndClearSharedPayload(id)` returns
`{ sharedText, file: null }`, and the landing page routes to Quick Add instead of the new-
transaction screen. No GET-only path, no second route.

**Rationale**: One code path for both content types is simpler and has less surface area to
keep in sync than two, and the platform constraint (research.md §2) rules out a genuinely
separate GET path anyway once file support exists in the same app.

**Alternatives considered**: A GET fallback for text-only shares alongside the POST target
for files — rejected; the manifest cannot declare two `share_target`s to choose between, so
this isn't actually an available option, only an initially-appealing misreading of the spec
this research corrects.

## 4. Where the pre-loaded text lands in Quick Add

**Decision**: `ShareTargetLandingPage.tsx` (research.md §2) resolves `parseSharedText`
(falling back `text` → `url` → `title`, matching the priority order most share sources use —
an SMS app typically shares its notification body as `text`) from the stashed payload and,
when no file is present, navigates to `/quick-add` via `navigate(path, { state: {
sharedText } })`. `QuickAddPage.tsx` reads `useLocation().state?.sharedText` once on mount
and, if present, seeds `rawText` with it and immediately runs the existing
`parseQuickAddText`/`isConfident` logic — the exact same code path already used when a user
manually pastes text and clicks "Parse," just triggered automatically instead of via a
button click. This guarantees FR-002's "identical parse result to manually pasting."

**Rationale**: Reusing `QuickAddPage.tsx`'s own parse call (rather than duplicating parsing
logic in the share-target route) is the only way to *structurally* guarantee FR-002 and
SC-002 ("100% of text shared to the app produces the same parsed result as pasting") — any
reimplementation would risk drift between the two paths.

**Alternatives considered**: Passing the shared text as a query param to `/quick-add`
directly (skipping the redirect page) — rejected; the manifest's `action` URL must be a
fixed path distinct from `/quick-add` (the Web Share Target spec matches shares to whatever
literal `action` URL is declared), so a dedicated landing route is required regardless, and
funneling through router `state` avoids leaking the shared text into `/quick-add`'s own URL
history.

## 5. Where the pre-attached image lands, given `NewTransactionPage.tsx` has no attachment UI today

**Decision**: Spec 005 deliberately scoped attachment management to *existing* transactions
only (`TransactionsPage.tsx`'s row action) and explicitly rejected adding attachment capture
to `NewTransactionPage.tsx`'s creation flow, since nothing in that spec's own acceptance
scenarios asked for it. This feature's FR-004 now explicitly does ask for it. Resolution:
add a small, optional "pre-attached image" section to `NewTransactionPage.tsx` — shown only
when the page is reached via `ShareTargetLandingPage.tsx`'s redirect for a file-bearing
share (router `state` carries the retrieved `File`) — that previews the image and, on
successful save, calls
`AttachmentRepository.create(key, { transactionId: newTransaction.id, ...compressedImage })`
using the exact same `validateAttachmentFile`/`compressImage` utilities `TransactionsPage.tsx`
already uses (spec 005), immediately after the transaction itself is created via the
existing `TransactionEngine` call.

**Rationale**: Reuses 100% of spec 005's validation, compression, and storage logic — no
parallel image-handling code path, no new crypto/storage surface (Constitution Principle
II/III). Scoped narrowly: the attachment section only ever renders when a shared image is
present, so the ordinary manual "add a new transaction" flow is visually and behaviorally
unchanged.

**Alternatives considered**: Redirecting a shared image to `TransactionsPage.tsx` instead,
requiring the user to first manually create a transaction and then use the existing
per-row attachment action — rejected; it fails FR-004's explicit requirement that the app
"open a new-transaction entry screen with that image pre-attached" in one step, defeating
the whole point of the share shortcut. Building a dedicated new page instead of extending
`NewTransactionPage.tsx` — rejected as unnecessary duplication of the entire transaction
entry form for one additional optional field.

## 6. No new dependencies

**Decision**: None beyond native browser APIs (Web Share Target manifest field, Service
Worker `fetch` event, `Cache` API, `URLSearchParams`) and the app's own existing
`imageAttachment.ts`/`AttachmentRepository` from spec 005.
