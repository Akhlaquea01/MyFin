<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0
- Modified principles: none (Principles I-VI unchanged)
- Modified sections:
  - Technology & Platform Constraints: named UI framework updated from "SvelteKit (or an
    equivalent lightweight framework already in use in the codebase)" to "React (with
    React Router), using shadcn/ui component primitives on Tailwind CSS". The
    implementation was rewritten from SvelteKit to React + shadcn/ui at the user's
    request for a more modern UI/UX; per this section's own rule, a core-stack change is
    a constitution amendment. Everything else in this section (Dexie.js, Web Crypto,
    installable/offline requirements, mobile-first/accessibility bar) is unchanged.
- Added sections: none
- Removed sections: none
- Deferred / TODO placeholders: none
- Templates requiring follow-up: specs/001-personal-finance-manager/plan.md and
  research.md updated in the same change to reflect the framework switch; tasks.md file
  paths for already-completed UI tasks likewise updated to their actual .tsx locations.
-->

# Personal Finance Manager (PWA) Constitution

## Core Principles

### I. Local-First & Zero-Server

The application MUST run entirely client-side with no backend server, no cloud sync, and
no server-side processing of user data. All application state and financial records MUST
be persisted on-device (IndexedDB) and MUST remain fully functional offline after first
load (via Service Worker asset caching). Any feature that would require a server-side
component (remote sync, cloud backup, server-side analytics) is out of scope unless the
constitution is amended.
**Rationale**: The project's entire value proposition is a private, zero-cost financial
tool the user fully controls. A server introduces cost, attack surface, and a trust
boundary the user explicitly rejected.

### II. Privacy & Encryption by Default (NON-NEGOTIABLE)

All financial data at rest MUST be encrypted using AES-GCM with a key derived via PBKDF2
from a user-supplied PIN/passphrase and a stored random salt. The derived encryption key
MUST be held only in memory and MUST NOT be persisted in any form. The PIN itself MUST
NOT be stored; only a salted hash of it may be stored, for verification. No sensitive
financial data (balances, transactions, account identifiers, PINs, derived keys) may
appear in logs, console output, error messages, or analytics in plaintext, in any build.
**Rationale**: Financial records are highly sensitive; the device may be lost, shared, or
compromised, and the user has no server-side recovery or moderation layer to fall back on.

### III. Layered Clean Architecture

The codebase MUST maintain strict one-way dependency flow: UI (components/pages/stores) →
Domain (use cases, engines: transaction, budget, recurring, forecast) → Data (repository
interfaces + implementations) → Storage (IndexedDB/Dexie adapter, encryption service).
Domain logic MUST NOT import from or depend on UI frameworks or concrete storage
implementations; it MUST depend only on repository interfaces so that storage and
encryption can be substituted or mocked in tests. Cross-layer shortcuts (e.g., UI code
calling Dexie directly) are prohibited.
**Rationale**: Financial calculations must be independently verifiable and testable; a
leaky architecture makes correctness bugs (double-counted transfers, wrong balances)
harder to catch and fix.

### IV. Test-First for Financial Logic (NON-NEGOTIABLE)

All domain/business logic that affects money — the transaction engine, budget engine,
recurring/matching engine, net worth calculation, and the SMS/text quick-add parser —
MUST have unit tests written and passing before the logic is considered done. Changes to
these engines MUST include tests that reconcile against known sample data sets (e.g.,
sum of transactions must equal reported balances; budget totals must match underlying
transactions). Integration tests are required for Dexie repository operations, and
end-to-end tests (Playwright) are required for the core money-entry and reconciliation
flows before a milestone is marked complete.
**Rationale**: Silent financial miscalculation is the single most damaging failure mode
for this product — it erodes the user's trust in their own records.

### V. Free & Open-Source Only

Every runtime dependency, build tool, and hosting provider MUST be free and open-source
(or free-tier with no recurring cost for this project's expected usage). No paid APIs, no
proprietary SaaS dependencies, and no infrastructure that introduces a recurring bill are
permitted. Hosting MUST be a static/free host (e.g., Netlify, Vercel, GitHub Pages) since
the app ships as static assets with no server component.
**Rationale**: A zero-cost, sustainable personal tool was an explicit project goal; paid
dependencies would undermine that goal and create a reason the project could be abandoned.

### VI. Data Integrity & Non-Destructive Operations

Monetary values MUST be stored as integers in the smallest currency unit (e.g., paise),
never as floating-point. Records MUST use UUIDs (`crypto.randomUUID()`) as primary keys.
Deletions MUST be soft deletes (a `deletedAt` timestamp) with a trash/undo path; permanent
purge requires explicit, separate user confirmation. Import and backup/restore flows MUST
perform duplicate detection before committing new records.
**Rationale**: Users must be able to trust that their financial history is accurate,
auditable, and recoverable from accidental deletion or duplicate import.

## Technology & Platform Constraints

The stack is TypeScript on Vite, with React (using React Router for client-side routing
and PWA support) and shadcn/ui component primitives on Tailwind CSS for the UI layer,
Dexie.js as the IndexedDB access layer, and the Web Crypto API for all cryptographic
operations — no custom or hand-rolled cryptographic primitives. The app MUST ship a
valid Web App Manifest and Service Worker so it is installable and offline-capable on
Android, iOS, and desktop. UI MUST be mobile-first and responsive, and MUST meet
baseline accessibility expectations (keyboard navigable, sufficient contrast, semantic
markup). Any change to this core stack (framework, database layer, or crypto approach)
is a constitution amendment, not a routine implementation decision.

## Development Workflow & Quality Gates

Every feature plan (`/speckit-plan`) MUST identify which architectural layer(s) it
touches and confirm it does not violate Principle III's dependency direction. Every
feature touching a money-affecting engine (Principle IV) MUST list its reconciliation
test cases in the plan or tasks before implementation begins. Performance-sensitive
work (e.g., transaction list rendering) MUST be validated against large datasets
(target: import and render 10k transactions without UI freeze) before being marked
complete. Production builds MUST strip debug/console logging. Any deviation from these
gates MUST be explicitly justified in the plan's Complexity Tracking section.

## Governance

This constitution supersedes any conflicting practice, template default, or ad-hoc
convention used elsewhere in this repository. Amendments require: (1) a documented
rationale for the change, (2) a version bump per the policy below, and (3) review of
dependent templates (plan, tasks, spec) for needed follow-up updates. All
`/speckit-plan` outputs MUST include a Constitution Check section verifying compliance
before implementation proceeds; unresolved violations MUST be justified in Complexity
Tracking or the plan MUST be revised.

Versioning policy (semantic versioning applied to governance):

- MAJOR: Backward-incompatible removal or redefinition of a principle (e.g., dropping
  the local-first or encryption-by-default requirement).
- MINOR: A new principle or materially expanded section is added.
- PATCH: Wording clarifications, typo fixes, or non-semantic refinements.

**Version**: 1.1.0 | **Ratified**: 2026-09-06 | **Last Amended**: 2026-09-06
