# Implementation Plan: Receipt & Photo Attachments

**Branch**: `005-receipt-attachments` | **Date**: 2026-09-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-receipt-attachments/spec.md`

## Summary

Users attach one or more photos (receipts, warranty cards) to an existing transaction from
the Transactions list, view them full-size, and remove them; attachments are compressed
client-side to bound storage, soft-delete/restore alongside their parent transaction for
free (no independent lifecycle), are cascade-hard-deleted on a new transaction "delete
forever" action, and are included in encrypted backup/restore. Technical approach: a new
`Attachment` entity/table, a browser-only compression utility using the native Canvas API
(no new dependency), a per-row action + dialog added to the existing `TransactionsPage.tsx`
(no new transaction-detail page), and the first permanent-purge flow in this codebase,
scoped specifically to Transactions.

## Technical Context

**Language/Version**: TypeScript 5.x, same evergreen-browser target as the core app (Vite)

**Primary Dependencies**: No new dependencies. Reuses React 19 + React Router, shadcn/ui on
Tailwind CSS, Dexie.js, and Vitest — all already in the core app's stack. Image compression
uses the native Canvas API only (research.md §2)

**Storage**: IndexedDB via Dexie.js — one new `attachments` table; attachment bytes are
base64-encoded and encrypted through the existing JSON-based crypto path (research.md §1),
not a separate binary-safe encryption mechanism

**Testing**: Vitest unit tests for `validateAttachmentFile` (pure w.r.t. a constructed
`File`'s type/size), a Dexie integration test for `AttachmentRepository` (including the
5-attachment cap and `TransactionRepository.purge`'s cascade), and a Playwright E2E test for
the full attach/view/remove/purge/backup flow (compression requires a real browser canvas,
so it is only exercised end-to-end, not in Vitest)

**Target Platform**: Same installable PWA (Android/iOS/desktop); the OS file picker offers
a camera option on supporting devices automatically via `<input type="file" accept="image/*">`
— no camera-specific code needed

**Project Type**: Web — single frontend-only project (no backend exists or is planned)

**Performance Goals**: The per-row "has an attachment" indicator must not reintroduce the
N-queries-per-render problem `TransactionsPage.tsx`'s existing virtualization (SC-008) was
built to avoid — it is populated via one bulk query per visible-window change, not one query
per row (research.md §4)

**Constraints**: Attachment bytes never touch disk unencrypted (Constitution Principle II);
a purge action is only reachable from Trash, never from an active transaction (Constitution
Principle VI); stored attachment size is bounded (target under 500KB per SC-003) regardless
of the original photo's size

**Scale/Scope**: Single user per installation, typically a handful of attachments per
transaction, capped at 5 (research.md §7); 3 prioritized user stories, 8 functional
requirements (see [spec.md](spec.md))

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                       | Check                                                                                                                                                                                                                                                                                          | Status |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| I. Local-First & Zero-Server                    | Compression and storage are entirely client-side; no network call introduced                                                                                                                                                                                                                   | PASS   |
| II. Privacy & Encryption by Default             | Attachment bytes are base64-encoded into the `Attachment` entity and encrypted through the same AES-GCM path as every other table — no new plaintext storage path (research.md §1)                                                                                                             | PASS   |
| III. Layered Clean Architecture                 | `src/lib/imageAttachment.ts` (browser-API utility, not domain logic) has no dependents in `src/domain/`; `AttachmentRepository` and the extended `TransactionRepository.purge` live in the data layer; the UI (`TransactionsPage.tsx`, `TrashPage.tsx`) calls only these, never Dexie directly | PASS   |
| IV. Test-First for Financial Logic              | Not a money-affecting engine — Attachment carries no monetary field, and this feature introduces no financial calculation. `validateAttachmentFile` still gets unit tests per good practice, but Principle IV's specific test-first mandate does not apply here (unlike specs 002/003/004)     | N/A    |
| V. Free & Open-Source Only                      | Zero new dependencies; native Canvas/File APIs only                                                                                                                                                                                                                                            | PASS   |
| VI. Data Integrity & Non-Destructive Operations | `Attachment.sizeBytes` and all numeric fields are integers; UUIDs throughout; the new purge action is explicit, separate, and only reachable from Trash — exactly the "permanent purge requires explicit, separate user confirmation" rule this principle already states                       | PASS   |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/attachment-service.md, quickstart.md):

- `contracts/attachment-service.md` confirms `AttachmentRepository` and
  `TransactionRepository.purge` are the only write paths for attachment data — no component
  writes to Dexie directly — Principle III intact.
- `data-model.md` confirms attachment bytes are a plaintext string field on `Attachment`,
  encrypted as part of the whole entity exactly like every other table — Principle II
  intact, no new crypto surface introduced.
- No new external dependency appears anywhere in data-model.md or the contract — Principle V
  intact.
- The purge contract explicitly restricts `TransactionRepository.purge` to
  already-soft-deleted transactions, keeping Principle VI's "explicit, separate
  confirmation" requirement enforceable at the repository layer, not just by UI convention.

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/005-receipt-attachments/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── attachment-service.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── lib/
│   └── imageAttachment.ts           # NEW: validateAttachmentFile(), compressImage()
│                                        (browser-API utility, per research.md §2-3)
│
├── data/
│   ├── dexie/
│   │   ├── db.ts                      # EXTENDED: attachments table
│   │   ├── attachmentRepository.ts    # NEW: AttachmentRepository
│   │   └── transactionRepository.ts   # EXTENDED: purge() cascading to splits/tags/attachments
│   └── io/
│       └── backupService.ts           # EXTENDED: attachments included (research.md §6)
│
└── pages/
    ├── TransactionsPage.tsx           # EXTENDED: per-row "Attachments" action + dialog,
    │                                     bulk has-attachment indicator (research.md §4)
    └── TrashPage.tsx                  # EXTENDED: "Delete forever" action for Transactions
                                          (research.md §5)

tests/
├── unit/
│   └── imageAttachment.test.ts        # NEW: validateAttachmentFile() boundary cases
├── integration/
│   └── attachmentRepository.test.ts   # NEW: cap enforcement, purge cascade, backup/restore
└── e2e/
    └── receiptAttachments.spec.ts     # NEW
```

**Structure Decision**: Extends the existing single frontend-only project layout unchanged
(see [../001-personal-finance-manager/plan.md](../001-personal-finance-manager/plan.md)'s
Structure Decision, reused as-is by specs 002-004). This feature adds one new browser-API
utility module, one new repository, and extends three existing files
(`TransactionRepository`, `TransactionsPage.tsx`, `TrashPage.tsx`, `backupService.ts`) — no
new architectural layer, no new project, and — notably — no new page, since the existing
transaction list is where attachment management lives (research.md §3).
