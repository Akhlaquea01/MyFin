<!--
Sync Impact Report
- Version change: 1.1.0 → 2.0.0
- Modified principles:
  - II. Privacy & Encryption by Default (NON-NEGOTIABLE) — the derived encryption key's
    persistence rule is redefined from an absolute "MUST be held only in memory and MUST NOT
    be persisted in any form" to a narrower, conditional rule: it MUST NOT be persisted in any
    form from which raw key bytes are extractable, but MAY be persisted as a non-extractable
    Web Crypto `CryptoKey` handle strictly to resume an already-unlocked session across a page
    reload, bounded by the same auto-lock timeout and cleared on explicit lock. This reconciles
    the constitution with the already-shipped session-persistence feature
    (`src/data/dexie/sessionKeyRepository.ts`), which the prior absolute wording forbade. This
    is a MAJOR bump per this document's own versioning policy: a NON-NEGOTIABLE principle's
    literal rule is being redefined, even though the underlying guarantee it exists to protect
    (raw key bytes never reachable by any script, ever) is unchanged and independently
    verified — see the session's own testing: `crypto.subtle.exportKey('raw', ...)` against
    the persisted row throws `InvalidAccessError: key is not extractable`.
- Modified sections: none beyond Principle II's body and rationale above.
- Added sections: none.
- Removed sections: none.
- Deferred / TODO placeholders: none.
- Templates requiring follow-up (not modified by this command; flagged for a future pass):
  - specs/001-personal-finance-manager/contracts/repository-interfaces.md line 93-94 and
    research.md still describe the encryption key as never persisted, held only in an
    in-memory module singleton — now only true outside the session-resume path. Update when
    that spec's docs are next touched.
  - specs/001-personal-finance-manager/plan.md line 54 ("key held only in memory (never
    persisted)") has the same staleness for the same reason.
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
from a user-supplied PIN/passphrase and a stored random salt. The PIN itself MUST NOT be
stored; only a salted hash of it may be stored, for verification. No sensitive financial
data (balances, transactions, account identifiers, PINs, derived keys) may appear in logs,
console output, error messages, or analytics in plaintext, in any build.

The derived encryption key MUST NOT be persisted in any form from which its raw bytes are
extractable by JavaScript. By default it MUST be held only in memory for the session's
lifetime. The sole permitted exception: it MAY be persisted as a non-extractable Web
Crypto `CryptoKey` object (e.g., via IndexedDB, which supports storing such a handle
without ever exposing its bytes to script) strictly to let an already-unlocked session
resume across a page reload without forcing a fresh PIN/biometric prompt. Any such
persisted handle MUST carry an expiry no later than the user's configured auto-lock
timeout, MUST be deleted immediately on explicit lock or timeout, and MUST fail if any code
path ever attempts to mark it extractable or export it. This exception exists to remove
friction (a reload no longer means re-entering a PIN seconds after unlocking) without
weakening the actual guarantee this principle protects: a stolen device's storage can never
yield raw key material, only an opaque handle the browser's own WebCrypto subsystem accepts
and nothing else can read.
**Rationale**: Financial records are highly sensitive; the device may be lost, shared, or
compromised, and the user has no server-side recovery or moderation layer to fall back on.
The session-resume exception trades a narrow, mechanically-verifiable slice of that posture
(a live, unlocked browser profile could be reused within the auto-lock window, same as any
"stay signed in" feature) for meaningfully less friction, while keeping the property that
actually matters — raw key bytes are never, under any circumstance, readable by script —
fully intact.

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
flows before a milestone is marked complete. This bar has, by established precedent
(specs 002-004, 006, 007), also been applied to derived/read-only analytics engines that
don't touch money directly but would silently mislead the user if their arithmetic were
wrong — new engines in that category MUST follow the same test-first discipline even
though they fall outside the four named engines above.
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

Biometric unlock (WebAuthn) is an optional, best-effort convenience layer on top of the
mandatory PIN, never a replacement for it: a device/browser that cannot support it (e.g.,
lacking the PRF extension) MUST fall back to the PIN cleanly, with a specific, honest
reason surfaced to the user rather than a silent or generic failure. The PIN remains the
one credential that can always unlock the app.

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

**Version**: 2.0.0 | **Ratified**: 2026-09-06 | **Last Amended**: 2026-09-07
