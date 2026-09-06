# Phase 0 Research: Auto-Categorization Rules & Learning

## 1. `resolveMerchant()` must return the matched alias, not just the merchant

**Decision**: Change `resolveMerchant(key, rawMerchantText): Promise<string>`
(`src/domain/parser/merchantResolver.ts:10`) to
`resolveMerchant(key, rawMerchantText): Promise<{ merchantId: string; aliasId: string }>`.
Both branches already have the alias at hand — `MerchantAliasRepository.findByAliasText`
returns the full `MerchantAlias` (including its `id`) on the existing-alias path, and the
new-merchant path already creates a self-referential alias whose `id` is available. Update
its two current call sites (`QuickAddPage.tsx`, `bulkTextImportService.ts`) to destructure the
new shape.

**Rationale**: Edge Case #2 in spec.md requires "a rule on the raw merchant alias" to be
distinguishable from and take precedence over "a rule on the canonical merchant" — a
`CategorizationRule` needs an optional `merchantAliasId` to express that specificity
(data-model.md), but there is no way to test alias-level rules against an incoming
transaction unless the resolver surfaces *which* alias actually matched, not only the
merchant it collapsed to.

**Alternatives considered**: Re-deriving the alias by a second lookup inside the
categorization engine (querying `MerchantAliasRepository.findByAliasText` again with the same
raw text) — rejected as a redundant duplicate query for data the resolver already computed
one line earlier; also fragile if the two lookups could ever disagree (e.g. a race with a
concurrent alias edit).

## 2. Rule precedence: exact alias beats merchant-level, mirroring the recurring engine's ordered-filter style

**Decision**: `pickBestRule(rules, merchantId, aliasId)` filters active, non-stale rules (see
§5) in two passes: first any rule with `merchantAliasId === aliasId` (exact alias match);
if none, fall back to any rule with `merchantId === merchantId && merchantAliasId === null`
(merchant-level rule). At most one rule of each kind is expected per merchant/alias, but if
several exist, the first hit wins — same "narrow-filter-then-take-one" shape as
`recurringEngine.ts`'s `matchTransaction()` (`src/domain/recurring/recurringEngine.ts:101`),
not a scored specificity ranking, since only two discrete specificity levels exist here.

**Rationale**: The codebase has no existing "most-specific-wins" resolver to reuse (research
finding: neither `MerchantAliasRepository.findByAliasText` nor the recurring engine ranks
multiple candidates by specificity), but the recurring engine's filter-then-first-match
pattern is the closest structural precedent and keeps this feature's engine consistent with
it rather than introducing a novel scoring scheme for a two-level case that doesn't need one.

**Alternatives considered**: A numeric specificity score per rule — rejected as unnecessary
complexity for exactly two levels (alias-scoped, merchant-scoped).

## 3. Learned suggestion = a capped streak, not a lifetime tally

**Decision**: `MerchantCategorySignal` stores `recentCategoryIds: string[]`, capped at
`MIN_STREAK` (3) entries, FIFO (oldest dropped when a new one is pushed past the cap — see
data-model.md). `deriveSuggestion(recentCategoryIds, minStreak = MIN_STREAK)` returns the
shared category id only when the array has reached `minStreak` length **and** every entry is
identical; otherwise `null`. Every transaction confirmation (via the new
`TransactionEngine.confirmTransaction`, §6) pushes that transaction's final chosen category
onto its merchant's array, regardless of whether the category came from a rule, a suggestion,
or the user's own manual choice/override.

**Rationale**: The spec's own Assumption describes the threshold in streak terms ("3
consecutive confirmations to the same category"), and Edge Case #3 ("alternates between two
categories with no clear majority... should not force a suggestion") falls out for free from
a fixed-size sliding window — an alternating pattern can never fill 3 slots with the same
value, so no extra "dominance ratio" tuning is needed. It also makes FR-007's "overriding
updates the learning signal" trivial: an override is nothing special, it's just the category
that actually got pushed, which naturally breaks a streak built on the previously-suggested
category. And it makes SC-003 ("never appears with fewer than the defined minimum... zero
false positives") true by construction — the array can never assert a streak it doesn't
literally hold.

**Alternatives considered**: A per-category running count with a dominance-ratio threshold
(e.g. "top category ≥ 70% of all confirmations") — rejected as needing a second tunable
constant and more subtle boundary behavior (a long history of a since-abandoned pattern can
keep "winning" on ratio alone) for no benefit the streak model doesn't already provide for
this spec's stated acceptance scenarios.

## 4. File import gains merchant resolution for the first time

**Decision**: `importService.ts`'s `importRows()` (`src/data/io/importService.ts:125`) calls
the same `resolveMerchant(key, descriptionColumnValue)` used by Quick Add/bulk import,
resolving/creating a `Merchant` + `MerchantAlias` per row and passing the resulting
`merchantId` into `TransactionEngine.recordTransaction`'s `NewTransactionInput`, exactly as
the other two paths already do (once §1's signature change lands).

**Rationale**: FR-002 explicitly requires pre-filling to work for "Quick Add, bulk text
import, **or file import**" — research found file import currently never resolves a merchant
at all (it only maps the description column into `notes`), so this feature cannot satisfy its
own core requirement for that entry path without adding this call. It is a small, additive
change reusing an already-proven function, not new merchant-matching logic.

**Alternatives considered**: Scoping this feature to Quick Add and bulk import only, leaving
file import unchanged — rejected as a direct contradiction of FR-002's explicit text.

## 5. Rule invalidity (FR-009) is computed at read/match time, never persisted as a flag

**Decision**: No `isInvalid` column is added to `CategorizationRule`. `pickBestRule`'s
orchestrator wrapper (`resolveCategorization`, contracts/categorization-engine.md) checks the
target `Category.deletedAt` for each candidate at match time and skips any rule whose category
is gone. `CategorizationRuleRepository.list()` (for the management UI) similarly resolves each
rule's category and returns a derived `isInvalid: boolean` alongside it, without writing
anything back to the rule row itself.

**Rationale**: Mirrors the exact "derived, never stored" precedent spec 003 already
established for `SavingsGoal` progress, and the general codebase pattern of filtering live
rows by `deletedAt` at read time (`CategoryRepository`/`AccountRepository.list()`) rather than
maintaining a separate cached validity flag anywhere. It also sidesteps the need for new
cross-entity invalidation plumbing on `CategoryRepository.softDelete` — nothing in this
codebase today cascades a soft-delete into flagging dependents, and this feature doesn't need
to be the first to add that machinery when a lazy check at the two call sites that matter
(matching, and the rules list) is sufficient and cheaper to reason about.

**Alternatives considered**: Eagerly flagging dependent rules inside
`CategoryRepository.softDelete` — rejected as a new cross-repository coupling (data layer
reaching into another table's writes) for a check that's just as correct and much simpler
computed lazily where it's actually consumed.

## 6. Provenance travels on `TransactionSplit`, not a new field on `Transaction`

**Decision**: Add one optional field, `categorizationSource?: 'rule' | 'suggestion'`, to the
`TransactionSplit` entity and its `SplitInput` counterpart. It is set by
`TransactionEngine.recordTransaction` when it auto-fills a split via `resolveCategorization`,
and left `undefined` for any manually-chosen or split-transaction category. Since it lives
inside `TransactionSplit`'s existing AES-GCM-encrypted blob (not an indexed Dexie column), it
requires no `db.version()` bump and no `backupService.ts` change — the field rides along
automatically with the rest of the entity, the same way any other whole-entity field would.

**Rationale**: `Transaction` itself is a poor fit — a transaction can have multiple splits
(only the categorization engine's own single-split pre-fill ever sets this field, but the
type must still live where category lives), and adding a schema-visible field to the
highest-traffic table for a feature-specific concern is unnecessary. Piggybacking on an
already-encrypted, already-fully-backed-up entity is the smallest change that gives the
Review Queue UI (FR-004's "visibly distinguished... suggestion") something to read.

**Alternatives considered**: A parallel lookup table mapping `transactionId → source` —
rejected as more moving parts (a new table, another backup-service line, another migration)
for information that is naturally 1:1 with the split it describes.

## 7. Where confirmation-driven learning is hooked

**Decision**: A new `TransactionEngine.confirmTransaction(key, txId, splits?, tagIds?)`
wraps `TransactionRepository.update(key, txId, { reviewStatus: 'confirmed' }, splits)` (and
`TransactionTagRepository.setTags` when `tagIds` is given), then reads the transaction's
`merchantId` and its (possibly just-updated) first split's `categoryId` and calls
`recordConfirmation(key, merchantId, categoryId)` to push onto that merchant's
`MerchantCategorySignal`. `ReviewPage.accept()` calls this instead of calling
`TransactionRepository.update` directly.

**Rationale**: Only the three auto-entry sources (Quick Add, bulk import, file import) ever
reach `reviewStatus: 'unreviewed'` — manual/transfer entries are created already-`confirmed`
(`TransactionRepository.create`'s default) and never pass through `ReviewPage` at all. So
hooking learning specifically into the Review Queue's confirm action already scopes it
exactly the way Story 2's Independent Test describes ("confirmed... during review") with no
extra source-type branching needed. For a transaction with more than one split (a case this
feature's own pre-fill never produces, but which a user can still create manually before
confirming), the signal attributes to the first split's category only — treating it as
representative of "the category this merchant's transaction landed in" is not observably
lossy for a learning signal that only ever needs one category per confirmation.

**Alternatives considered**: Recording the signal at `TransactionRepository.create` time
(when the pre-fill is first applied) instead of at confirm time — rejected because FR-007
requires an override *during review* to be what updates the signal; recording at creation
would reinforce the original guess even when the user immediately corrects it, which is
exactly backwards from what "learning from corrections" means.

## 8. New Dexie tables, additive schema bump

**Decision**: `db.version(6).stores({ categorizationRules: 'id, merchantId, deletedAt',
merchantCategorySignals: 'id' })`, following the existing additive-only versioning
convention (each new spec adds one `db.version(N)` block; earlier blocks are never edited).
`merchantCategorySignals` is keyed directly by `merchantId` (one row per merchant, no
secondary index needed) — a "keyed singleton per merchant," the same shape idea as
`DebtPlannerPreference`'s single `'local-user'` row, just keyed per-merchant instead of
globally.

**Rationale**: Consistent with every prior spec's (`002`-`005`) additive versioning pattern
already established in `db.ts`. Keying `merchantCategorySignals` by `merchantId` avoids a
separate index/lookup for what is always a single-row-per-merchant read.

**Alternatives considered**: A UUID primary key with a separate `merchantId` index column —
rejected as strictly more indirection for a table that is never queried by anything other
than its owning merchant's id.
