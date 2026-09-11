# Phase 1 Data Model: Share-to-Quick-Add

Per the spec's own Key Entities section, this feature introduces **no new persisted
entity** — it is an alternate entry path into the existing `Transaction` (via Quick Add,
`reviewStatus=unreviewed`) and `Attachment` (spec 005) flows. Nothing below is a Dexie
table; it documents the transient, browser-cache-and-in-memory shapes this feature passes
between its own pages, for implementation clarity only.

## Transient shape 1 — the Cache API hand-off buffer (written by the service worker)

The manifest declares exactly one `share_target` (research.md §2), so every share — with
or without an image — arrives at `src/sw-share-target.ts`'s fetch handler as one POST.
Written once per share, read and deleted exactly once by `readAndClearSharedPayload(id)`
(`src/lib/shareTarget.ts`), keyed by a generated id embedded in the
`ShareTargetLandingPage.tsx` redirect URL (`?id=...`):

| Cache key | Type | Notes |
| --- | --- | --- |
| `meta:<id>` | JSON `Response` — `{ sharedText: string \| null }` | `sharedText` is `text`, falling back to `url`, then `title` (research.md §4) — resolved once by `parseSharedText` at write time |
| `file:<id>` | `Response` wrapping the raw file `Blob` | Present only when the share included an image; the shared image's raw bytes, exactly as received in the `multipart/form-data` POST body |

**Validation**: The service worker only moves bytes/fields, unopinionated about content.
MIME type allowlist and size cap are enforced later by the existing
`validateAttachmentFile` (spec 005), at the point `NewTransactionPage.tsx` receives the
file via router `state` (below) — never by the service worker itself.

## Transient shape 2 — the resolved payload handed to a page (in-memory only)

What `ShareTargetLandingPage.tsx` gets back from `readAndClearSharedPayload(id)` and
forwards via React Router `state`, never persisted anywhere, discarded the instant the
receiving page reads it on mount:

| Field | Type | Notes |
| --- | --- | --- |
| sharedText | string \| null | Forwarded to `/quick-add` as router `state.sharedText` when non-null and no file is present |
| file | File \| null | Forwarded to `/transactions/new` as router `state.sharedFile` when present, taking priority over `sharedText` per FR-004 |

## Entity Relationship Summary

```
(no new entities)

Transaction 1---* Attachment   (unchanged from spec 005 — a share-originated image becomes
                                 an ordinary Attachment only once the transaction is saved)
```

## Changes to existing entities/services

- **`Transaction`** (existing): unchanged. A share-originated transaction is created via the
  existing `TransactionEngine` call `NewTransactionPage.tsx` already makes; nothing about
  its shape changes because it originated from a share.
- **`Attachment`** (existing, spec 005): unchanged schema. Gains one additional *caller* —
  `NewTransactionPage.tsx`'s post-save hook, alongside the existing caller in
  `TransactionsPage.tsx` — but no new field, validation rule, or cap.
