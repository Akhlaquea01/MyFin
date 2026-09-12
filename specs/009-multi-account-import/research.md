# Phase 0 Research: Multi-Account Transaction Import

## 1. Where the new logic lives: pure helpers inside `importService.ts`, not a new domain module

**Decision**: Add `resolveAccountForRow(value, accounts)` and
`findAccountNameCollisions(values, accounts)` as pure, exported functions in
`src/data/io/importService.ts`, alongside the file's existing pure helpers
(`parseDateWithFormat`, `parseAmount`). `importRows()` (already the impure orchestrator that
calls `TransactionRepository`/`TransactionEngine`) calls them.

**Rationale**: `importService.ts` already mixes pure parsing helpers with one impure
orchestrator function in a single file — that's the established pattern for this feature area
(no separate `domain/import/` engine exists or is needed elsewhere). Account resolution here
is a simple, single-purpose lookup over an already-fetched list, not a reusable cross-feature
engine like `categorizationEngine.ts` — introducing a new domain module for two small pure
functions would be structure for its own sake.

**Alternatives considered**: A new `src/domain/import/accountResolver.ts` module — rejected as
unnecessary indirection; nothing outside `importService.ts` needs to call these functions.

## 2. Archived accounts must be fetched for resolution, but not for the fallback picker

**Decision**: `ImportPage.tsx` currently calls `AccountRepository.list(key, false)`
(`src/pages/ImportPage.tsx:62`), which excludes archived accounts — that list is used both to
populate the plain "Account" fallback dropdown and (today) as the only account list in scope.
This feature changes that call to `AccountRepository.list(key, true)` (include archived) and
derives `activeAccounts = accounts.filter(a => !a.isArchived)` locally for the fallback
dropdown, while passing the full (including-archived) list to `resolveAccountForRow`/
`findAccountNameCollisions` and to `importRows()`. This keeps the fallback dropdown's existing
active-only behavior unchanged while satisfying FR-003's requirement that archived accounts be
valid column-based matches.

**Rationale**: Directly required by the FR-003 clarification (archived accounts are eligible
matches). Changing the single `list()` call's `includeArchived` argument and filtering locally
for the one place that must stay active-only is the smallest change that satisfies both
requirements without a second Dexie query.

**Alternatives considered**: Two separate `AccountRepository.list()` calls (one `true`, one
`false`) — rejected as a redundant second decrypt-and-fetch pass over the same table for data
the single `true` call already contains a superset of.

## 3. Account-name collision detection is a whole-file pre-pass, not a per-row check

**Decision**: Before the existing per-row loop in `importRows()`, when `mapping.accountColumn`
is set: collect the distinct, non-blank, trimmed account-column values across all rows, and
call `findAccountNameCollisions(distinctValues, accounts)`, which — for each value — does a
case-insensitive name match against `accounts` and returns any value that matches more than
one account. If the result is non-empty, `importRows()` throws before creating any
transaction, naming the colliding account name(s) in the error message, mirroring the existing
`MAX_IMPORT_ROWS` pre-check that also throws before the row loop begins.

**Rationale**: FR-006 requires the *entire* import to be blocked, not just the rows that
happen to reference the colliding name — a partial commit followed by an error would leave the
user with an inconsistent, hard-to-reason-about result. Checking once over the distinct values
(bounded by the number of distinct account names actually used in the file, not the row count)
is cheap and gives an actionable, complete error message on the first attempt rather than
surfacing collisions one row at a time.

**Alternatives considered**: Detecting the collision lazily inside the per-row loop (first
ambiguous row aborts) — rejected because it would create transactions for every row processed
before the ambiguous one, contradicting FR-006's "no transactions from any row are created."

## 4. Duplicate-detection index becomes per-account, built lazily

**Decision**: The existing single duplicate-index build
(`TransactionRepository.search(key, { accountId: mapping.accountId })`, run once before the
loop) becomes a `Map<accountId, Map<dateAmountKey, txId>>`, populated lazily the first time a
row resolves to a given account. Each row's duplicate check and index update then goes through
that account's own map, exactly as today's single map is used.

**Rationale**: A file that references, say, 3 of the user's 10 accounts should only pay the
cost of fetching those 3 accounts' existing transactions, not all 10 — building every touched
account's index upfront (before knowing which accounts are actually referenced) or building
one shared index across all accounts would either do unnecessary work or corrupt the ±1-day
same-amount duplicate rule (FR-020/FR-038 base rule) by comparing dates/amounts across
unrelated accounts.

**Alternatives considered**: One combined index keyed by `accountId|date|amount` built for all
accounts up front — rejected as unbounded eager work when only a handful of accounts are
actually referenced in a given file.

## 5. Balance recalculation extends to every touched account, still once each

**Decision**: `importRows()` collects the set of distinct account ids that received at least
one created transaction and calls `TransactionEngine.recalculateAccountBalance` once per id
after the loop, instead of once for the single `mapping.accountId`.

**Rationale**: Preserves the existing "recalculate once, not once per row" performance
optimization (recalculation is O(account size)) while correctly updating every account a
multi-account import actually touched, not just one.

**Alternatives considered**: Recalculating inside the row loop whenever the resolved account
differs from the previous row's — rejected as more complex for no benefit; a single
end-of-import pass per touched account is simpler and already the existing pattern.

## 6. Matching is by name only — no ID-based fallback

**Decision**: `resolveAccountForRow` matches the column value against `Account.name` only
(case-insensitive, trimmed). It does not also try matching the raw value against `Account.id`.

**Rationale**: The finalized spec (FR-003) describes matching "against the user's existing
accounts" by name; account ids are internal `crypto.randomUUID()` values never surfaced to the
user in any UI, so a source file could not realistically carry them. An earlier, pre-Spec-Kit
sketch of this feature (`architecture.md` in this directory) proposed a name-then-ID fallback
for "power users" — this plan does not carry that over, since it adds a matching path no
normal export would ever populate and the spec's clarified collision-blocking behavior already
handles the one case (ambiguous names) that ID matching might otherwise have been used to
disambiguate.

**Alternatives considered**: Keeping the ID fallback from the earlier sketch — rejected as
dead code path for this feature's actual user base (spreadsheet-editing end users, not
developers with access to internal ids). This directory's pre-existing `architecture.md`,
`checklist.md`, and `test-cases.md` (which predate this Spec Kit workflow) have been updated
to drop the ID-fallback sketch and match this decision.

## 7. No Dexie schema change

**Decision**: `ColumnMapping.accountColumn?: string` and `ImportResult.perAccountSummary?:
Record<string, { count: number; accountName: string }>` are added to existing in-memory
TypeScript interfaces in `importService.ts`. Neither is persisted — `ColumnMapping` is built
fresh from `ImportPage.tsx` state on every import attempt and discarded afterward;
`ImportResult` is only ever held in React state to render the result card.

**Rationale**: Nothing about this feature needs to survive a page reload or be queried later;
extending two existing runtime-only interfaces requires no `db.version()` bump and no
`backupService.ts` change, consistent with how purely in-memory feature state is handled
elsewhere in the codebase.

**Alternatives considered**: None — there is no plausible reason to persist either type.
