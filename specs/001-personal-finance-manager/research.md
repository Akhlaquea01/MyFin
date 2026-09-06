# Phase 0 Research: Personal Finance Manager (PWA)

No open `NEEDS CLARIFICATION` markers remain in Technical Context — the constitution
already fixes the core stack (TypeScript, Vite, a component-based frontend framework,
Dexie.js, Web Crypto). The items below are the implementation-level decisions Phase 0
exists to pin down before design. **Decisions #1 and #2 were superseded mid-implementation**
when the UI framework changed from SvelteKit to React + shadcn/ui at the user's request —
see the "Framework note" in plan.md and the superseded entries below for what changed and
why.

## 1. UI component/styling approach — SUPERSEDED 2026-09-06

- **Original decision** (superseded): Tailwind CSS with a small set of hand-built
  components on SvelteKit, no component library.
- **Superseded by**: the user asked mid-implementation for a more modern UI/UX and to
  switch to React with a proper component library. **New decision**: shadcn/ui (Radix UI
  primitives + Tailwind CSS v4, `lucide-react` icons) on React + React Router.
- **Rationale**: shadcn/ui components are copied into the repo and fully owned/stylable
  (no opaque runtime dependency), pair directly with the Tailwind CSS already chosen, and
  give the polished, current look the user asked for without violating Principle V
  (everything is still free/OSS with no added hosting cost).
- **Alternatives considered at the time of the switch**: Mantine (rejected: heavier,
  more opinionated, less copy-in customization); Chakra UI (rejected: visual language
  reads more generic/dated next to shadcn's current look). See also decision #2 below,
  which changed alongside this one since it's a full framework swap, not just a styling
  change.

## 2. State management — SUPERSEDED 2026-09-06

- **Original decision** (superseded): native Svelte stores (`writable`/`derived`).
- **Superseded by**: moving to React (see #1) means Svelte stores no longer exist as an
  option. **New decision**: React Context (`src/context/SessionContext.tsx`) for the
  session/lock state, plain component state (`useState`) elsewhere, `react-hook-form` +
  `zod` for form state/validation (paired with shadcn/ui's documented form patterns).
- **Rationale**: React Context is sufficient for the one piece of genuinely cross-cutting
  state (the in-memory encryption key/lock status) — the same "no dependency without a
  clear purpose" reasoning as the original decision, just re-applied on the new framework.
  `react-hook-form` + `zod` is the standard, idiomatic pairing for shadcn/ui forms and
  keeps validation logic declarative and colocated with each form.
- **Alternatives considered**: Redux Toolkit/Zustand (rejected: unnecessary weight for one
  piece of shared state); hand-rolled form state (rejected: `react-hook-form` is the
  ecosystem-standard choice shadcn/ui itself documents).
- **Known library friction** (see also the account-selection UX decision in
  spec.md/plan.md's Framework note): calling `form.setValue()` or `form.reset()` from a
  `useEffect` promise callback to set a Controller-bound field's value after async data
  loads did not reliably propagate to the rendered Select in practice, even though the
  approach is commonly documented. Rather than chase this further, the affected forms
  (New Transaction, Transfer) simply never pre-select an account — the user always picks
  explicitly, which is arguably better UX anyway once there is more than one account.

## 3. PWA tooling (manifest + service worker) — partially superseded 2026-09-06

- **Decision**: `vite-plugin-pwa` (Workbox under the hood) for manifest generation and
  offline asset caching, configured with `registerType: 'autoUpdate'`. This choice itself
  didn't change in the framework rewrite — only the integration package did: the
  SvelteKit-specific `@vite-pwa/sveltekit` wrapper was replaced with plain
  `vite-plugin-pwa` used directly in `vite.config.ts`, matching a standard Vite+React
  project.
- **Rationale**: Free/OSS, integrates directly with the Vite build regardless of UI
  framework, avoids hand-writing a service worker and its cache-invalidation logic.
- **Alternatives considered**: Hand-rolled service worker (rejected: reinvents
  well-tested caching-strategy code for no benefit).

## 4. Durable storage request (FR-044)

- **Decision**: Call `navigator.storage.persist()` on first successful PIN setup (not on
  first paint, so the request is tied to the point data first exists), then read
  `navigator.storage.persisted()` on every subsequent app start to decide whether to show
  the "storage not protected" warning banner (Edge Case, FR-044).
- **Rationale**: Chrome/Edge/Firefox grant persistence automatically under common
  conditions (installed PWA, bookmarked site, high engagement) and expose an explicit API;
  Safari (iOS/macOS) does not support the Storage API's `persist()` call at all as of
  current shipping versions, so the warning path is the realistic behavior on Safari, not
  an edge case.
- **Alternatives considered**: Silently ignoring persistence (rejected — this is exactly
  the FR-044/SC-011 clarification the spec called out as unacceptable); repeatedly
  prompting the user (rejected: annoying, and the browser API is not a permission prompt
  the user can "retry" in most implementations).

## 5. Single-instance (multi-tab) enforcement (FR-045)

- **Decision**: Use the Web Locks API (`navigator.locks.request`) to have each tab compete
  for a single named lock on load; the tab holding the lock is the "active" read-write
  instance, all others render a blocking "already open in another tab" screen and poll for
  the lock to become available (also cross-checked via `BroadcastChannel` for browsers
  needing a fallback).
- **Rationale**: Web Locks is purpose-built for exactly this coordination problem and is
  supported in all target browsers; it avoids building a custom heartbeat/leader-election
  protocol.
- **Alternatives considered**: `BroadcastChannel`-only leader election (rejected as
  primary mechanism: more code to get right, kept only as a fallback signal); allowing
  concurrent tabs and relying on Dexie transactions alone (rejected: Dexie transactions
  protect a single write, not cross-tab read-modify-write sequences like balance
  recalculation, so this could not fully prevent the corruption risk the spec's
  clarification called out).

## 6. Encryption parameters

- **Decision**: PBKDF2-SHA256 with 210,000 iterations (current OWASP-recommended
  minimum) to derive a 256-bit key from the PIN and a per-installation random salt;
  AES-GCM with a unique random 96-bit IV per encrypted record.
- **Rationale**: Matches current cryptographic guidance for password-based key derivation
  and authenticated encryption, achievable entirely through the native Web Crypto API with
  no added dependency (Constitution Principle II and V).
- **Alternatives considered**: A lower iteration count for faster unlock (rejected:
  materially weakens resistance to offline brute-force of a short numeric PIN, which is
  the primary threat model here); a KDF not natively supported by Web Crypto, like Argon2
  (rejected: would require a WASM dependency for no clear benefit over PBKDF2 at this
  threat level).

## 7. CSV/XLSX libraries

- **Decision**: Papa Parse for CSV parsing/writing, `exceljs` for XLSX read/write.
- **Rationale**: Both are free/OSS and directly match the source requirements for
  column-mapped import and spreadsheet export. `exceljs` was chosen over the npm `xlsx`
  (SheetJS) package because the npm registry's `xlsx` build is stuck below the version
  that fixes a high-severity prototype-pollution advisory (GHSA-4r6h-8v6p-xvw6), with no
  further fix published to npm; `exceljs` has no equivalent unpatched high/critical
  advisory. (`exceljs` does carry a moderate, transitive `uuid` advisory —
  GHSA-w5hq-g745-h8pq — but it only fires when `uuid.v3/v5/v6` is called with a
  caller-supplied output buffer, a code path `exceljs` does not use internally; accepted
  as a documented, low-practical-risk transitive issue rather than a reason to downgrade
  `exceljs` by a major version.)
- **Alternatives considered**: Hand-rolled CSV parsing (rejected: edge cases in quoting/
  encoding are well-solved problems); npm `xlsx`/SheetJS (rejected: unpatched high-severity
  advisory, see above); SheetJS's own CDN-distributed patched build (rejected: sourcing a
  dependency from outside the npm registry complicates auditing and reproducible installs
  for a security-sensitive app, for no benefit `exceljs` doesn't already provide); SheetJS
  Pro (rejected: paid, violates Principle V).

## 8. Charting

- **Decision**: Chart.js.
- **Rationale**: Free/OSS, lightweight, covers every chart type the spec's Analytics
  story needs (category breakdown, trend lines, cash flow).
- **Alternatives considered**: ECharts (rejected: larger bundle for capabilities this
  app's analytics scope doesn't need).

## 9. Quick-add / bulk-text parser strategy

- **Decision**: A rule-based parser (regex + keyword heuristics for amount, merchant,
  and debit/credit direction) with a confidence score; anything below a confidence
  threshold routes to manual entry (FR-021), and matches are deduplicated per the FR-020/
  FR-038 rule (same account + amount + date within ±1 day).
- **Rationale**: Matches the source material's parser design and keeps everything
  on-device with no ML dependency, preserving the local-first/zero-server principle.
- **Alternatives considered**: An on-device ML model (rejected: unnecessary complexity
  and bundle size for a well-structured text format; rule-based matches the >95% accuracy
  target in SC-003 for common bank/payment notification formats).

## 10. Testing stack confirmation

- **Decision**: Vitest for unit tests, `@testing-library/svelte` for component tests,
  Dexie tests run against `fake-indexeddb` in Node for fast integration runs (plus smoke
  coverage in real browsers via Playwright), Playwright for E2E flows.
- **Rationale**: Free/OSS, standard pairing for a Vite-based project, satisfies
  Constitution Principle IV's test-first requirement for every money-affecting engine.
- **Alternatives considered**: Jest (rejected: Vitest is the natural fit for a Vite
  project with faster, ESM-native execution).

## 11. Encrypted-record indexing strategy (implementation-phase decision)

- **Decision**: Each Dexie table stores one row per entity with (a) a small set of
  **plaintext structural columns** needed for indexed queries — `id`, foreign keys
  (`accountId`, `categoryId`, etc.), `date`, `deletedAt`, and `reviewStatus` — and (b) a
  single `encryptedData` column holding the AES-GCM ciphertext of the _entire_ plaintext
  entity (including those same structural fields, so the decrypted object is
  self-describing and the plaintext columns are purely a query index, not a second source
  of truth). Every value a human would consider "the data" — amounts, notes, merchant
  names, account/category names, PIN verifier, etc. — exists in plaintext nowhere on disk.
- **Rationale**: FR-005/Constitution Principle II require financial data to be unreadable
  without the PIN; FR-013 (search/filter) and SC-008 (10k-transaction search under 1s)
  require IndexedDB's native indices, which cannot range-query inside an opaque encrypted
  blob. Treating opaque UUIDs, dates, and status enums as low-sensitivity structural
  metadata (they reveal that _some_ transaction happened on a date, never the amount,
  merchant, or note) is the standard pattern for client-side encrypted apps that still need
  to be searchable, and keeps the actually sensitive values encrypted.
- **Alternatives considered**: Encrypting every field with nothing left in plaintext
  (rejected: every list/search/filter/report screen would have to decrypt the entire table
  on every render, which cannot meet SC-008 at 10k+ rows in a browser main thread); storing
  a separate unencrypted search index alongside encrypted records (rejected: duplicates
  data and widens the attack surface for no real gain over indexing the same non-sensitive
  fields directly).
- **Exception — `UserProfile`**: stored entirely unencrypted. Its fields (`pinSalt`,
  `encryptionSalt`, `pinVerifierHash`, lock/biometric preferences) must be readable
  _before_ a key can be derived at all — a PBKDF2 salt and a one-way PIN verifier are not
  secrets by design (their security comes from the KDF's iteration count, not from hiding
  them), so there is nothing here that encryption-at-rest would protect.
- **Duplicate detection follow-on**: `Transaction.amount` stays inside the encrypted blob
  (research.md decision above), so `findPossibleDuplicates` (FR-020/038) cannot index on
  amount directly. It instead uses the `accountId` + `date` indices to narrow to the small
  candidate set of transactions on that account within the ±1-day window, decrypts only
  that narrow set, and compares amounts in memory — never a full-table decrypt.

**Output**: All research items resolved; no unresolved unknowns remain for Phase 1 design.
