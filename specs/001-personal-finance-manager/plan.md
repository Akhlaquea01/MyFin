# Implementation Plan: Personal Finance Manager (PWA)

**Branch**: `001-personal-finance-manager` | **Date**: 2026-09-06 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-personal-finance-manager/spec.md`

## Summary

A single-user, offline-first personal finance manager delivered as an installable PWA with
no backend: users track accounts, transactions, transfers, budgets, recurring finances,
investments, and liabilities entirely in an encrypted local database, with a dashboard,
analytics, quick text-based entry, and encrypted import/export/backup. Technical approach:
a React + TypeScript single-page PWA (Vite, React Router, shadcn/ui on Tailwind CSS),
Dexie.js over IndexedDB for storage, and the Web Crypto API (PBKDF2 + AES-GCM) for
encryption — all free/open-source, matching the project constitution's local-first,
zero-server, encrypt-by-default mandate.

> **Framework note (2026-09-06)**: The UI layer was originally built in SvelteKit and was
> rewritten to React + shadcn/ui partway through implementation, at the user's request, for
> a more modern UI/UX. Only the UI layer changed — `src/domain/` and `src/data/` (crypto,
> Dexie schema, repositories, engines) are framework-agnostic TypeScript and carried over
> unmodified; all 24 unit/integration tests kept passing untouched through the rewrite,
> which is exactly what Constitution Principle III's layering is for. Historical decisions
> below that predate the rewrite are kept for the record, with a note where superseded —
> see also research.md's addenda.

## Technical Context

**Language/Version**: TypeScript 5.x, targeting evergreen browsers (ES2020+), via Vite 8.x

**Primary Dependencies**: React 19 + React Router (client-side routing, static PWA shell),
shadcn/ui on Radix UI primitives + Tailwind CSS v4 (UI components), react-hook-form + zod
(form state/validation), Dexie.js (IndexedDB access), native Web Crypto API (AES-GCM +
PBKDF2 — no crypto library dependency), Papa Parse (CSV), exceljs (XLSX), FileSaver.js
(downloads), Chart.js (charts), vite-plugin-pwa (manifest + service worker generation)

**Storage**: IndexedDB only, via Dexie.js; no server-side or cloud storage of any kind

**Testing**: Vitest (unit — domain engines, framework-agnostic), Dexie integration tests
against `fake-indexeddb` or a real browser IndexedDB, Playwright (E2E — core money-entry,
lock/unlock, backup/restore flows)

**Target Platform**: Installable PWA on Android (Chrome), iOS (Safari), and desktop
(Chrome/Edge/Firefox/Safari); must run fully offline after first load

**Project Type**: Web — single frontend-only project (no backend service exists)

**Performance Goals**: Transaction list search/scroll over 10k records responds in <1s
(SC-008); a manual transaction can be recorded in <15s end-to-end (SC-004); dashboard
figures render as soon as underlying data is read, with no separate "loading" round trip
since there is no network call

**Constraints**: Fully offline-capable; all cryptography client-side with the encryption
key held only in memory (never persisted); every dependency and hosting target free/OSS
(Constitution Principle V); mobile-first responsive, baseline-accessible UI; only one
active app instance (tab) may hold write access at a time (FR-045); durable storage MUST be
requested on first run (FR-044)

**Scale/Scope**: Single user per installation; 9 prioritized user stories, 45 functional
requirements (see [spec.md](spec.md)); target dataset ~10k transactions without
degradation

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                                       | Check                                                                                                                                                                                                                                   | Status                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| I. Local-First & Zero-Server                    | No backend/server/cloud component is planned anywhere in this design; the app is a static SPA (Vite + React Router), deployed as static assets                                                                                          | PASS                                         |
| II. Privacy & Encryption by Default             | All financial data encrypted at rest via AES-GCM with a PBKDF2-derived key held only in memory; PIN never stored, only a salted verifier; no plaintext in logs (enforced via lint rule + production console stripping, see research.md) | PASS                                         |
| III. Layered Clean Architecture                 | Project Structure below enforces `domain/` (engines) → `data/` (repository interfaces + Dexie/crypto adapters) → UI, with one-way imports                                                                                               | PASS                                         |
| IV. Test-First for Financial Logic              | Testing stack includes unit tests for every money-affecting engine and integration tests for repositories; enforced at the tasks/implementation phase, not weakened by this plan                                                        | PASS (process gate, verified in tasks phase) |
| V. Free & Open-Source Only                      | Every dependency listed (React, React Router, shadcn/ui, Radix UI, Tailwind, react-hook-form, zod, Dexie, Papa Parse, exceljs, FileSaver.js, Chart.js, vite-plugin-pwa) is free/OSS; hosting target is a free static host               | PASS                                         |
| VI. Data Integrity & Non-Destructive Operations | Data model (Phase 1) stores money as integers, uses UUID keys, and models `deletedAt` soft-delete on transactions/accounts                                                                                                              | PASS                                         |

No violations identified. **Complexity Tracking is not needed for this plan.**

### Post-Design Re-Check

Re-evaluated after Phase 1 (data-model.md, contracts/, quickstart.md):

- Data model stores money as integers, uses UUID PKs, and models `deletedAt` soft-delete
  exactly as Principle VI requires — confirmed, no drift.
- Repository interfaces (contracts/repository-interfaces.md) keep `domain/` engines
  depending only on interfaces, never on Dexie/crypto directly — confirmed, Principle III
  intact.
- The backup format (contracts/backup-format.md) and CryptoService both keep the
  encryption key PIN-derived and in-memory-only — confirmed, Principle II intact.
- No new external dependency was introduced beyond the free/OSS set already listed in
  Technical Context — Principle V intact.

**Result: PASS, no new violations. Complexity Tracking remains empty.**

## Project Structure

### Documentation (this feature)

```text
specs/001-personal-finance-manager/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── repository-interfaces.md
│   ├── backup-format.md
│   └── csv-import-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created here)
```

### Source Code (repository root)

```text
src/
├── domain/                  # Domain layer: use cases & engines (framework-agnostic TS)
│   ├── transactions/         # transaction engine: create/edit/delete, splits, transfers
│   ├── budgets/               # budget engine: periods, rollover, sinking funds
│   ├── recurring/             # recurring rule engine, expected-event matching
│   ├── wealth/                 # net worth / investment / liability calculations
│   ├── analytics/              # aggregation logic for charts/reports
│   └── parser/                  # quick-add / bulk-text transaction parser
│
├── data/                     # Data layer: repository interfaces + implementations
│   ├── repositories/          # interfaces (contracts) consumed by domain/UI
│   ├── dexie/                   # Dexie schema, adapters implementing repositories
│   ├── crypto/                   # PBKDF2 key derivation + AES-GCM encrypt/decrypt service
│   └── io/                        # CSV/XLSX import-export, backup/restore serializers
│
├── context/                  # React context (session/lock state — replaces the earlier
│                               #   Svelte-store design after the framework rewrite)
├── lib/                       # Framework-agnostic-ish app utilities: webauthn, single-tab
│                               #   lock (Web Locks API), console-stripping, shadcn's cn()
├── components/
│   ├── ui/                     # shadcn/ui primitives (button, card, dialog, select, ...)
│   └── *.tsx                    # Onboarding/Lock/Blocked screens, AppShell (nav), banners
├── pages/                     # Route-level pages (React Router): dashboard, accounts,
│                               #   transactions (+ new/transfer), categories, trash, and
│                               #   the budgets/recurring/wealth/analytics/backup pages the
│                               #   remaining user stories will add
├── App.tsx                   # Root gate (single-instance → onboarded → unlocked) + routes
└── main.tsx                  # Entry point

public/
└── manifest is generated by vite-plugin-pwa; icons/, favicon.svg, robots.txt

tests/
├── unit/                     # Vitest: one suite per domain/ engine (framework-agnostic)
├── integration/              # Dexie repository + crypto round-trip tests (framework-agnostic)
└── e2e/                      # Playwright: onboarding/lock, ledger, backup-restore flows
```

**Structure Decision**: Single frontend-only project (no backend exists or is planned).
The `domain/` → `data/` → UI (`pages/`, `components/`, `context/`, `lib/`) layout directly
implements Constitution Principle III: domain engines depend only on repository interfaces
declared in `data/`, never on Dexie or crypto implementations directly, so storage can be
mocked in unit tests and swapped without touching business logic — this is exactly what
let the UI framework be swapped from SvelteKit to React mid-project without touching
`domain/` or `data/` at all.
