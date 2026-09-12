# Phase 1 Data Model: Multi-Account Transaction Import

No new persisted entity and no Dexie schema change. This feature extends two existing,
runtime-only (never stored) TypeScript interfaces already defined in
`src/data/io/importService.ts`, and reads (never writes) the existing `Account` entity.

## Extended: `ColumnMapping` (existing, in-memory only)

| Field | Type | Notes |
| --- | --- | --- |
| dateColumn | string | Existing, unchanged. |
| amountColumn | string | Existing, unchanged. |
| descriptionColumn | string \| undefined | Existing, unchanged. |
| accountId | string | Existing. Used as the destination for every row when `accountColumn` is not set (FR-002); also the destination for any row that doesn't itself resolve when `accountColumn` *is* set is **not** a fallback — such a row is skipped and reported (FR-004), it never falls back to `accountId`. |
| **accountColumn** | string \| undefined | **NEW.** The name of the file column that carries a per-row account name. When absent, behavior is identical to today (FR-002). |
| dateFormat | string | Existing, unchanged. |
| amountSignConvention | `'negative-is-expense' \| 'separate-debit-credit-columns'` | Existing, unchanged. |
| debitColumn / creditColumn | string \| undefined | Existing, unchanged. |

**Validation**: `accountColumn`, when set, must be one of the parsed file's headers (enforced
by the UI populating the selector from `parsed.headers`, same pattern as every other column
selector already on this page).

## Extended: `ImportResult` (existing, in-memory only)

| Field | Type | Notes |
| --- | --- | --- |
| createdCount | number | Existing, unchanged. |
| skippedMalformedRows | `{ rowNumber: number; reason: string }[]` | Existing. Gains two new possible `reason` strings: `"Account column is empty."` and `` `Account "${value}" not found.` `` (FR-004). |
| flaggedDuplicates | `{ rowNumber: number; existingTransactionId: string }[]` | Existing, unchanged in shape; now scoped per resolved account (research.md §4). |
| **perAccountSummary** | `Record<string, { count: number; accountName: string }> \| undefined` | **NEW.** Present when `accountColumn` was used; keyed by account id, one entry per account that received at least one created transaction (FR-007, FR-008 in spec). Absent for a single-account import, preserving the existing result shape exactly. |

## Read-only: `Account` (existing entity, unchanged)

This feature reads `Account.name`, `Account.id`, and `Account.isArchived` — it does not add,
remove, or change any field on `Account`, and never writes to it.

| Field (relevant subset) | Type | Relevance to this feature |
| --- | --- | --- |
| id | UUID | The value written to `Transaction.accountId` once a row's account is resolved. |
| name | string | Matched case-insensitively, whitespace-trimmed, against each row's account-column value (FR-003). Not currently unique (see below) — this is why FR-006 exists. |
| isArchived | boolean | Archived accounts are still valid matches (FR-003) — this feature does not filter them out, unlike `ImportPage`'s existing fallback account dropdown. |

**Known pre-existing constraint this feature must not assume away**: `AccountRepository`
(`src/data/dexie/accountRepository.ts`) enforces no uniqueness on `name` today. This feature
does not add such a constraint either (that would be a separate, larger change affecting
account creation/editing everywhere) — it only detects the resulting ambiguity at import time
and blocks (FR-006) rather than silently guessing.

## Derived (not persisted): account-name collision check

The shape `findAccountNameCollisions` returns to `importRows()` — not a table, an in-memory
pre-pass result (contracts/import-account-resolution.md).

| Field | Type | Notes |
| --- | --- | --- |
| (return value) | `string[]` | The subset of the file's distinct account-column values that match more than one existing account by name. Empty means the import may proceed. |

## Entity Relationship Summary

```
Account (existing, spec 001)
  ^
  | matched by name (case-insensitive, trimmed; archived included)
  |
ColumnMapping.accountColumn --> resolveAccountForRow(rowValue, accounts) --> Account.id | null
                              --> findAccountNameCollisions(distinctValues, accounts) --> string[]

importRows(key, rows, mapping, accounts)
  --> [pre-pass] findAccountNameCollisions --> throws if non-empty (FR-006, zero rows created)
  --> per row: resolveAccountForRow --> Account.id, else skip + report (FR-004)
  --> per resolved account: lazy duplicate index (research.md §4), TransactionEngine.recordTransaction
  --> per touched account: TransactionEngine.recalculateAccountBalance (research.md §5)
  --> ImportResult.perAccountSummary (one entry per touched account)
```
