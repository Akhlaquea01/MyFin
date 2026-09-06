# Contract: Categorization Engine

This app has no external API; its "contracts" are the internal interfaces between the domain
engine (`src/domain/categorization/`), its orchestrator, `TransactionEngine`, and their
callers, per Constitution Principle III's one-way dependency rule.

## Pure functions (`src/domain/categorization/categorizationEngine.ts`)

### `pickBestRule(rules, merchantId, aliasId): RuleCandidate | null`

```ts
interface RuleCandidate {
	id: string;
	merchantId: string;
	merchantAliasId: string | null;
	categoryId: string;
	tagIds: string[];
}
```

Given a list of already-fetched, already-filtered-to-non-stale (data-model.md's "Invalidity")
candidate rules for one merchant: returns the first rule with `merchantAliasId === aliasId`
if any exists; otherwise the first rule with `merchantId === merchantId && merchantAliasId
=== null`; otherwise `null`. Never mutates its input; performs no I/O.

### `deriveSuggestion(recentCategoryIds, minStreak = 3): string | null`

Returns `recentCategoryIds[0]` iff `recentCategoryIds.length === minStreak` and every entry
strictly equals the first; otherwise `null`. Never mutates its input; performs no I/O.

## Orchestrator (`src/domain/categorization/resolveCategorization.ts`)

### `resolveCategorization(key, merchantId, aliasId): Promise<CategorizationResult | null>`

**Behavior**:

1. Load active rules for `merchantId` via
   `CategorizationRuleRepository.listForMerchant(key, merchantId)` (already excludes
   soft-deleted rows).
2. For each candidate, resolve its `categoryId` via `CategoryRepository.getById`; drop any
   whose category is missing or has `deletedAt !== null` (FR-009 — stale rules never apply).
3. Call `pickBestRule(nonStaleRules, merchantId, aliasId)`. If it returns a rule, return
   `{ categoryId: rule.categoryId, tagIds: rule.tagIds, source: 'rule' }`.
4. Otherwise, load `MerchantCategorySignalRepository.get(key, merchantId)`. If found, call
   `deriveSuggestion(signal.recentCategoryIds)`. If it returns a category id, and that
   category is not itself soft-deleted, return
   `{ categoryId, tagIds: [], source: 'suggestion' }`.
5. Otherwise, return `null` (no pre-fill — the caller falls through to today's
   `__uncategorized__` default).

**Error cases**: Never throws for a missing merchant/no rules/no signal — all three are
treated as "nothing to apply," returning `null`.

### `recordConfirmation(key, merchantId, categoryId): Promise<void>`

Loads (or lazily creates) the `MerchantCategorySignal` row for `merchantId`, pushes
`categoryId` onto `recentCategoryIds`, trims to the last `MIN_STREAK` (3) entries, and
persists it via `MerchantCategorySignalRepository.push(key, merchantId, categoryId)`. Called
once per confirmed transaction's (first) category — see `TransactionEngine.confirmTransaction`
below. Never throws; a merchant with no prior signal simply starts a fresh one-entry array.

## `TransactionEngine` integration (`src/domain/transactions/transactionEngine.ts`)

### `recordTransaction(key, input, splits = [])` — extended

When called with `splits.length === 0` and `input.merchantId` truthy (i.e. the caller isn't
already specifying a category, which today only Quick Add/bulk/file import ever omit): calls
`resolveCategorization(key, input.merchantId, input.merchantAliasId)`. `input` gains an
optional `merchantAliasId?: string | null` field so callers can pass through what
`resolveMerchant()` (research.md §1) returned alongside `merchantId`. If a result comes back,
builds a single full-amount split `{ categoryId: result.categoryId, amount: input.amount,
categorizationSource: result.source }` and, if `result.tagIds.length > 0`, calls
`TransactionTagRepository.setTags(key, tx.id, result.tagIds)` after the transaction is
created. If `resolveCategorization` returns `null`, behavior is unchanged from today
(`__uncategorized__` default split).

### `confirmTransaction(key, txId, splits?, tagIds?): Promise<Transaction>` — new

1. Calls `TransactionRepository.update(key, txId, { reviewStatus: 'confirmed' }, splits)`.
2. If `tagIds` is given, calls `TransactionTagRepository.setTags(key, txId, tagIds)`.
3. Reads the transaction's `merchantId`; if set, reads its (possibly just-updated) first
   split and calls `recordConfirmation(key, merchantId, firstSplit.categoryId)`.
4. Returns the updated `Transaction`.

**Error cases**: Propagates whatever `TransactionRepository.update` throws (e.g. split-sum
mismatch); step 3 is skipped silently (no throw) when the transaction has no `merchantId` or
no splits.

## Repository interfaces consumed

- `CategorizationRuleRepository`:
  - `create(key, input): Promise<CategorizationRule>`
  - `update(key, id, changes): Promise<CategorizationRule>`
  - `softDelete(key, id) / restore(key, id): Promise<void>` — mirrors `SavingsGoalRepository`
  - `listForMerchant(key, merchantId): Promise<CategorizationRule[]>` — live (non-deleted)
    rules only, used by `resolveCategorization`
  - `list(key): Promise<Array<CategorizationRule & { isInvalid: boolean }>>` — for the
    management UI (Story 3); `isInvalid` is computed per-row against `CategoryRepository`,
    never stored (research.md §5)
- `MerchantCategorySignalRepository`:
  - `get(key, merchantId): Promise<MerchantCategorySignal | null>`
  - `push(key, merchantId, categoryId): Promise<MerchantCategorySignal>` — the read-modify-
    write `recordConfirmation` uses internally
  - `reset(key, merchantId): Promise<void>` — clears the row (FR-006's "dismiss/reset")
  - `listSuggestions(key): Promise<Array<{ merchantId: string; categoryId: string }>>` — every
    merchant whose `deriveSuggestion(recentCategoryIds)` is non-null and whose category isn't
    stale, for the management UI (Story 3)
