# Contract: Share Target Handling

This app has no external API; its "contracts" are the internal interfaces between the
new browser-API utility (`src/lib/shareTarget.ts`), the standalone service worker
(`src/sw-share-target.ts`), the single landing page, and their callers, per Constitution
Principle III's one-way dependency rule.

## Web App Manifest (`vite.config.ts`, `VitePWA({ manifest: {...} })`)

Adds a single `share_target` member (pass-through field; not part of `vite-plugin-pwa`'s
narrower TypeScript manifest type, so it is spread in as an untyped extension of the
manifest object). The Web App Manifest spec allows exactly one `share_target` per app
(research.md §2), so both content types (text and image) are declared under it:

```jsonc
"share_target": {
  "action": "/share-target",
  "method": "POST",
  "enctype": "multipart/form-data",
  "params": {
    "title": "title",
    "text": "text",
    "url": "url",
    "files": [{ "name": "file", "accept": ["image/*"] }]
  }
}
```

A share with no image arrives as a POST with just the `title`/`text`/`url` fields
populated and no `file` part; a share of an image arrives with `file` populated (and
possibly `text`/`title` too, e.g. a caption). Both are handled by the same service worker
and the same landing page.

## `src/sw-share-target.ts` (new, narrow-scope service worker)

Registered via `navigator.serviceWorker.register('/sw-share-target.js', { scope:
'/share-target/' })` (called once from `App.tsx`, alongside the existing `vite-plugin-pwa`
registration — the two registrations do not interfere, since their scopes differ; the
POST action itself is served at `/share-target`, one level below the SW's own registration
path convention used elsewhere in this app).

### `fetch` event handler

Listens only for `POST` requests to the manifest's `action` URL (`/share-target`). On
match:

1. Reads the incoming request's `multipart/form-data` body via `request.formData()`.
2. Extracts `text` (falling back to `url`, then `title` — research.md §4) and, if present,
   the `file` field's `File`.
3. Generates a random id (`crypto.randomUUID()`) and `put`s a single JSON `Response`
   (`{ sharedText: string | null }`) into a named `Cache` (e.g. `share-target-buffer`)
   under the key `meta:<id>`; if a file was included, also `put`s a `Response(file)` under
   `file:<id>`.
4. Responds with a redirect (`303`) to `/share-target-landing?id=<id>`.

Any other request passes through untouched (`return` without calling
`event.respondWith`), so this service worker never interferes with normal navigation or
the root service worker's own caching.

## `src/lib/shareTarget.ts`

### `parseSharedText(fields: { text?: string; url?: string; title?: string }): string | null`

Pure function: returns `text`, falling back to `url`, then `title`, or `null` if none are
present/non-empty (research.md §4). Unit-testable in Vitest — takes plain string fields,
not a live `URLSearchParams`/`FormData`, so the service worker and any test can both
construct its input trivially.

### `readAndClearSharedPayload(id: string): Promise<{ sharedText: string | null; file: File | null }>`

Opens the `share-target-buffer` Cache, reads the `meta:<id>` and `file:<id>` entries (the
latter only if present), deletes both in the same call (so a given `id` can only ever be
consumed once — a page reload after consumption correctly yields
`{ sharedText: null, file: null }`, not a stale re-attach), and returns the combined
payload. Requires the Cache API — not callable from Vitest's Node environment; covered by
Playwright E2E instead.

## `src/pages/ShareTargetLandingPage.tsx` (new)

On mount: reads the `id` query param, calls `readAndClearSharedPayload(id)`, then:

- If `file` is present: `navigate('/transactions/new', { replace: true, state: {
  sharedFile: file } })`.
- Else if `sharedText` is present: `navigate('/quick-add', { replace: true, state: {
  sharedText } })`.
- Else (missing/already-consumed/unsupported content — Edge Case): `navigate('/quick-add',
  { replace: true })` with no state, and a toast explaining the shared content could not be
  retrieved.

Renders nothing user-visible beyond a brief loading state — this route is a pure redirect.

## `src/pages/QuickAddPage.tsx` (extended)

Reads `useLocation().state?.sharedText` once on mount via a `useEffect`; if present, sets
`rawText` to it and immediately invokes the same parse call the manual "Parse" button
triggers (FR-002). No other change to this page's existing behavior.

## `src/pages/NewTransactionPage.tsx` (extended)

Reads `useLocation().state?.sharedFile` once on mount. If present:

- Shows a small preview (thumbnail + filename) above the existing form.
- On successful save (after the existing `TransactionEngine` call creates the
  `Transaction`), calls `validateAttachmentFile(sharedFile)`; if valid, `compressImage` then
  `AttachmentRepository.create(key, { transactionId: newTransaction.id, ...compressed })`
  (spec 005's existing functions/repository, no new logic). If invalid (wrong type/too
  large), the transaction still saves per the form's own fields, and a toast explains the
  image specifically could not be attached — the user is not blocked from saving because
  the *shared image* turned out to be unsupported (Edge Case: unsupported content type).

## Error cases

- `readAndClearSharedPayload` finds no entry for `id` (already consumed, or the service
  worker never wrote it — e.g. an unsupported browser routed the POST elsewhere) →
  resolves `{ sharedText: null, file: null }`; `ShareTargetLandingPage.tsx` treats this as
  "no shared content" and still lands the user on a normal, empty Quick Add screen rather
  than an error page.
- Multiple files shared at once (Edge Case) → the manifest's `files` mapping accepts one
  named field; a multi-file share arrives as repeated `file` parts in the same
  `FormData`. The service worker stashes only the first as `file:<id>` for this feature's
  first cut, matching the spec's "none silently dropped" requirement via a documented,
  explicit scope limit (flagged for `/speckit-tasks` to decide whether to extend) rather
  than a silent drop.
- On a browser/OS with no Web Share Target support, the manifest field and the narrow-scope
  service worker are simply never invoked — no error path needed; the app behaves exactly
  as it does today (FR-007).
