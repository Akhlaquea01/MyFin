# Contract: Import Account Resolution

This app has no external API; its "contracts" are the internal interfaces between the new
pure helpers, the existing `importRows()` orchestrator, and their caller (`ImportPage.tsx`),
per Constitution Principle III's one-way dependency rule.

## Pure functions (`src/data/io/importService.ts`)

### `resolveAccountForRow(value, accounts): Account | null`

```ts
function resolveAccountForRow(value: string, accounts: Account[]): Account | null;
```

Trims `value`; if empty, returns `null`. Otherwise finds the (at most one, given collisions
are pre-blocked — see below) account in `accounts` whose `name`, trimmed, equals `value`
case-insensitively, and returns it, or `null` if none match. Considers every account passed
in, including archived ones (FR-003) — the caller is responsible for passing the
including-archived list, not a pre-filtered one. Never mutates its input; performs no I/O.

### `findAccountNameCollisions(values, accounts): string[]`

```ts
function findAccountNameCollisions(values: string[], accounts: Account[]): string[];
```

For each distinct, non-blank, trimmed value in `values`, checks (case-insensitively) how many
accounts in `accounts` have that name. Returns the subset of `values` for which more than one
account matches, deduplicated, in first-seen order. Returns `[]` when every value is
unambiguous (including when a value matches zero accounts — that's `resolveAccountForRow`'s
concern, not a collision). Never mutates its input; performs no I/O.

## Orchestrator (`src/data/io/importService.ts`, existing function extended)

### `importRows(key, rows, mapping, accounts?): Promise<ImportResult>` — extended

New optional 4th parameter `accounts: Account[]`, required (non-empty) whenever
`mapping.accountColumn` is set; unused when it isn't (preserves today's exact single-account
behavior, FR-002).

**Behavior when `mapping.accountColumn` is set**:

1. Collect the distinct, trimmed, non-blank values of `row[mapping.accountColumn]` across all
   `rows`.
2. Call `findAccountNameCollisions(distinctValues, accounts)`. If it returns a non-empty list,
   throw an error naming the colliding account name(s) (e.g. `Account name "Checking" matches
   more than one account. Rename one of them and try again.`) **before processing any row** —
   no transaction is created (FR-006).
3. For each row (existing loop, unchanged date/amount parsing): resolve its account via
   `resolveAccountForRow(row[mapping.accountColumn], accounts)`.
   - Blank value → push `{ rowNumber, reason: 'Account column is empty.' }` to
     `skippedMalformedRows`; skip the row (FR-004).
   - Non-blank, no match → push
     `` { rowNumber, reason: `Account "${value}" not found.` } `` to `skippedMalformedRows`;
     skip the row (FR-004).
   - Match found → use that account's `id` as the row's `accountId` for
     `TransactionEngine.recordTransaction`, in place of `mapping.accountId`.
4. Duplicate detection and the balance recalculation pass use a per-account index/set instead
   of the single `mapping.accountId` used today (research.md §4-5); everything else (date/
   amount parsing, merchant resolution, progress yielding, `MAX_IMPORT_ROWS`) is unchanged.
5. `ImportResult.perAccountSummary` is populated with one entry per account that received at
   least one created transaction: `{ [accountId]: { count, accountName } }`.

**Behavior when `mapping.accountColumn` is not set**: identical to today — every row uses
`mapping.accountId`, `perAccountSummary` is left `undefined`, `accounts` (if passed) is
ignored.

**Error cases**: The `MAX_IMPORT_ROWS` throw and the new collision throw both happen before
any row is processed, so either aborts with zero transactions created. All per-row failures
(unparseable date/amount, empty/unresolved account) are non-throwing — reported in
`skippedMalformedRows` — exactly like today's behavior for bad dates/amounts.

## Caller (`src/pages/ImportPage.tsx`)

- Fetches accounts via `AccountRepository.list(key, true)` (including archived — research.md
  §2), then derives `activeAccounts = accounts.filter(a => !a.isArchived)` for the existing
  fallback "Account" dropdown, which keeps excluding archived accounts exactly as it does
  today.
- Adds an "Account column (optional)" selector populated from `parsed.headers`, mirroring the
  existing optional "Description column" selector's UI pattern.
- Before enabling the Import button, when an account column is selected: calls
  `findAccountNameCollisions` client-side over the parsed preview data and `accounts`, and if
  it returns any names, disables Import and shows which name(s) are ambiguous and why — the
  same check `importRows()` performs, surfaced early so the user isn't left waiting for a
  throw.
- Preview table gains a resolved-account column when an account column is selected, showing
  each row's matched account name or an unresolved/blank indicator, using
  `resolveAccountForRow` against the same `accounts` list (FR-005).
- Result card shows a per-account breakdown (`Object.entries(result.perAccountSummary)`) when
  `perAccountSummary` has more than one entry; unchanged single-line summary otherwise.
