# Phase 1 Data Model: Auto-Categorization Rules & Learning

Conventions follow the core app's data model: UUID primary keys (except where noted),
integers for every monetary field (none in this feature — no entity here carries money),
`createdAt`/`updatedAt` timestamps, and AES-GCM-encrypted-at-rest storage for the plaintext
shape described below (this feature introduces no unencrypted table).

## CategorizationRule (new)

The spec's "Categorization Rule" key entity (Story 1) — an explicit, user-authored mapping.

| Field            | Type              | Notes                                                                                                                                                                       |
| ---------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id               | UUID              | PK                                                                                                                                                                          |
| merchantId       | ID                | Indexed. The canonical `Merchant` this rule targets.                                                                                                                       |
| merchantAliasId  | ID \| null        | When set, scopes the rule to this one specific `MerchantAlias` (the "more specific" case in Edge Case #2); when `null`, matches any alias resolving to `merchantId`.       |
| categoryId       | ID                | Target category. Not indexed — never queried by category, only listed per-merchant/globally.                                                                              |
| tagIds           | ID[]              | Zero or more `Tag` ids applied alongside `categoryId` (FR-001). Empty array = no tags.                                                                                     |
| createdAt        | timestamp         |                                                                                                                                                                              |
| updatedAt        | timestamp         |                                                                                                                                                                              |
| deletedAt        | timestamp \| null | Indexed. Soft-delete (Constitution Principle VI), mirrors `SavingsGoal`'s pattern — a deleted rule is restorable from Trash and simply stops matching until restored.      |

**Validation**: `categoryId` must reference a category that exists at creation time (the UI
only offers live categories); FR-009's "target category later deleted" is a *runtime* state
detected at read/match time (research.md §5), not a write-time constraint — a rule is never
rejected for referencing a category that becomes stale after the fact.

**Invalidity (FR-009, derived, never stored)**: A rule is *stale* when
`Category.deletedAt !== null` (or the category no longer exists) for its `categoryId`. Stale
rules are skipped during matching and shown flagged in the rules list, but the row itself is
never mutated to record this — recomputed every time it's read (research.md §5).

## MerchantCategorySignal (new)

The spec's "Merchant Category Signal" key entity (Stories 2-3) — internal, not directly
user-editable. One row per merchant that has ever had a confirmed transaction.

| Field            | Type      | Notes                                                                                                                                                                          |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id               | ID        | PK — **is** the merchant's own id (one row per merchant; a "keyed singleton," research.md §8), not a fresh UUID.                                                              |
| recentCategoryIds | ID[]     | FIFO ring buffer, capped at `MIN_STREAK` (3) entries — the most recent confirmed categories for this merchant, oldest-first. Never longer than 3 (research.md §3).            |
| createdAt        | timestamp |                                                                                                                                                                                 |
| updatedAt        | timestamp |                                                                                                                                                                                 |

**Validation**: Pushing a new category id past the cap drops the oldest entry (`shift()`
then `push()`, or equivalent). No independent soft-delete — "reset" (FR-006) means clearing
`recentCategoryIds` to `[]` (or deleting the row outright; both are equivalent to "no
suggestion until a new pattern re-forms").

**Learned suggestion (derived, never stored)**: `deriveSuggestion(recentCategoryIds)` returns
`recentCategoryIds[0]` iff `recentCategoryIds.length === MIN_STREAK` and every entry is equal;
otherwise `null`. This is a pure function over the row's own field, not a separately persisted
value (contracts/categorization-engine.md).

## Extended: TransactionSplit (existing entity, one new optional field)

| Field                | Type                            | Notes                                                                                                                                    |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| categorizationSource | `'rule' \| 'suggestion'` \| undefined | NEW. Set only when `TransactionEngine.recordTransaction` auto-filled this split via `resolveCategorization`; absent for every other split (manual entry, split transactions, or a category the user picked/changed themself). Lives inside the entity's existing encrypted blob — no Dexie schema change (research.md §6). |

`SplitInput` (the repository-layer write shape) gains the same optional field so
`TransactionRepository.create`/`update` can carry it through into the persisted
`TransactionSplit`.

## Derived (not persisted): CategorizationResult

The shape `resolveCategorization()` returns to `TransactionEngine.recordTransaction`; not a
table, just an in-memory decision.

| Field      | Type                        | Notes                                                                 |
| ---------- | --------------------------- | ---------------------------------------------------------------------- |
| categoryId | ID                          |                                                                        |
| tagIds     | ID[]                        | Always `[]` for a `source: 'suggestion'` result (learning tracks category only, never tags — FR-004 only ever mentions "the learned category") |
| source     | `'rule' \| 'suggestion'`    |                                                                        |

## Entity Relationship Summary

```
Merchant 1---* MerchantAlias                     (existing, spec 001)
Merchant 1---1 MerchantCategorySignal            (new; id = merchantId)
Merchant 1---* CategorizationRule                (new; optionally scoped to one MerchantAlias)
CategorizationRule *---1 Category                (new -> existing; target may go stale, FR-009)
CategorizationRule *---* Tag  (via tagIds)        (new -> existing)

resolveCategorization(merchantId, aliasId)
  --> pickBestRule(rules, merchantId, aliasId)          [alias-scoped rule, else merchant-scoped rule]
  --> else deriveSuggestion(signal.recentCategoryIds)   [category only, no tags]
  --> else null (falls through to today's manual review)
  --> CategorizationResult --> TransactionSplit.categoryId/categorizationSource, TransactionTag rows

TransactionEngine.confirmTransaction(txId, ...)
  --> TransactionRepository.update(reviewStatus: 'confirmed', splits?)
  --> recordConfirmation(merchantId, finalCategoryId) --> MerchantCategorySignal.recentCategoryIds
```
