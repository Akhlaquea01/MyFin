# Multi-Account Import - Implementation Checklist

> Updated to match the finalized [spec.md](spec.md) clarifications: name-only matching (no
> ID fallback), archived accounts are valid matches, and an ambiguous account name blocks the
> whole import (FR-006) rather than being silently resolved to one of the matches. See
> [tasks.md](tasks.md) for the authoritative, task-by-task breakdown this checklist summarizes.

## Backend Changes (importService.ts)

### Type Updates
- [ ] Update `ColumnMapping` interface
  - [ ] Add `accountColumn?: string` field
  - [ ] Keep `accountId` for backward compatibility (used only when `accountColumn` is unset)

- [ ] Update `ImportResult` interface
  - [ ] Add `perAccountSummary?: Record<string, { count: number; accountName: string }>`

### New Functions
- [ ] Implement `resolveAccountForRow()` (name-only — no ID fallback, research.md §6)
  ```typescript
  function resolveAccountForRow(
    value: string,
    accounts: Account[]   // ALL accounts, including archived
  ): Account | null
  ```
  - [ ] Trim whitespace from value; blank → `null`
  - [ ] Case-insensitive name match against every account passed in, including archived ones
  - [ ] Return `null` if no match
  - [ ] Pure function — no I/O, no `async`

- [ ] Implement `findAccountNameCollisions()` (NEW, FR-006 — whole-file pre-pass)
  ```typescript
  function findAccountNameCollisions(
    values: string[],
    accounts: Account[]
  ): string[]
  ```
  - [ ] Dedupe + trim + drop blanks from `values`
  - [ ] For each distinct value, count case-insensitive name matches in `accounts`
  - [ ] Return the values that match more than one account (first-seen order)
  - [ ] Pure function — no I/O

### Update importRows() Function
- [ ] Add `accounts: Account[] = []` parameter
- [ ] Add the pre-pass collision check (runs before the row loop, only when
      `mapping.accountColumn` is set): collect distinct account-column values, call
      `findAccountNameCollisions`, and `throw` naming the colliding account if any are found —
      zero transactions must be created when this throws
- [ ] Modify per-row account resolution logic:
  ```typescript
  let txAccountId: string;
  if (mapping.accountColumn) {
    const raw = row[mapping.accountColumn] ?? '';
    if (!raw.trim()) {
      result.skippedMalformedRows.push({ rowNumber, reason: 'Account column is empty.' });
      continue;
    }
    const resolved = resolveAccountForRow(raw, accounts);
    if (!resolved) {
      result.skippedMalformedRows.push({
        rowNumber,
        reason: `Account "${raw.trim()}" not found.`
      });
      continue;
    }
    txAccountId = resolved.id;
  } else {
    txAccountId = mapping.accountId;
  }
  ```
- [ ] Replace the single duplicate-detection index with one built lazily per resolved account
      (`Map<accountId, Map<dateAmountKey, txId>>`) — not one shared index, not built eagerly
      for accounts the file doesn't reference
- [ ] Replace the single end-of-import `recalculateAccountBalance` call with one call per
      distinct account that received a created transaction
- [ ] Build `perAccountSummary` only when `mapping.accountColumn` is set; leave it `undefined`
      otherwise
- [ ] Include `perAccountSummary` in the returned result

### Validation Updates
- [ ] In `importRows()`, handle empty account column values (skip + report, not throw)
- [ ] Report per-row account resolution failures in `skippedMalformedRows`
- [ ] Report a file-wide name collision by throwing before any row is processed (distinct
      from the per-row skip-and-report path above)

## Frontend Changes (ImportPage.tsx)

### State Management
- [ ] Add state: `const [accountColumn, setAccountColumn] = useState('')`
- [ ] Change the accounts fetch from `AccountRepository.list(key, false)` to
      `AccountRepository.list(key, true)` (include archived — required for FR-003)
- [ ] Derive `const activeAccounts = accounts.filter(a => !a.isArchived)` and use it (not
      `accounts`) for the existing fallback "Account" dropdown, so that dropdown's behavior is
      unchanged
- [ ] Update the `mapping` object built in `handleImport` to include `accountColumn`

### UI Components - Column Mapping Section
- [ ] After the Account selector, add an Account column selector:
  ```tsx
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="import-account-col">Account column (optional)</Label>
    <Select value={accountColumn} onValueChange={setAccountColumn}>
      <SelectTrigger id="import-account-col" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">None - use selected account</SelectItem>
        {parsed.headers.map((h) => (
          <SelectItem key={h} value={h}>
            {h}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
  ```

### UI Behavior - Account Selector Conditional
- [ ] When `accountColumn` is set:
  - [ ] The fallback "Account" selector is not required (informational only, or hidden)
  - [ ] Show help text: "Account will be read from the '<column>' column per row (including
        archived accounts)."
- [ ] When `accountColumn` is NOT set:
  - [ ] Account selector is required, built from `activeAccounts`
  - [ ] Validation: `canImport` requires `!!accountId` only when `accountColumn` is empty

### Collision Banner (NEW, FR-006)
- [ ] Recompute `findAccountNameCollisions` over the parsed rows' account-column values and
      `accounts` whenever the file or the account column selection changes
- [ ] When it returns any names: disable the Import button and show which name is ambiguous
      and why (e.g. "Account name 'Checking' matches more than one account. Rename one of
      them before importing.")
- [ ] `canImport` must be `false` while any collision is present

### Preview Table Update
- [ ] Add an "Account (Resolved)" column to the preview table, shown only when an account
      column is selected
- [ ] For each preview row:
  - [ ] If `accountColumn` is set: resolve via `resolveAccountForRow` and show the matched
        account name, or a clear "not found"/"empty" indicator
  - [ ] If `accountColumn` is NOT set: show the single selected account's name (unchanged)
- [ ] Show account resolution status visually (e.g. ✅ / ❌ prefix)

### Handle Import Call
- [ ] Pass the fetched `accounts` array (including archived) to `importRows()`:
  ```typescript
  const importResult = await importRows(key, parsed.rows, mapping, accounts);
  ```

### Result Display Update
- [ ] After a successful import, display a per-account summary when present and multi-entry:
  ```tsx
  {result.perAccountSummary && Object.entries(result.perAccountSummary).length > 1 && (
    <div className="mt-3 text-sm">
      <p className="font-medium mb-2">Imported by account:</p>
      <ul className="list-inside list-disc text-muted-foreground">
        {Object.entries(result.perAccountSummary).map(([, summary]) => (
          <li key={summary.accountName}>
            {summary.count} to {summary.accountName}
          </li>
        ))}
      </ul>
    </div>
  )}
  ```

## Testing Checklist

### Unit Tests (importService.ts)
- [ ] `resolveAccountForRow()` with exact name match
- [ ] `resolveAccountForRow()` with case-insensitive name match
- [ ] `resolveAccountForRow()` with whitespace in input
- [ ] `resolveAccountForRow()` with non-existent account → `null`
- [ ] `resolveAccountForRow()` matches an archived account exactly like an active one
- [ ] `findAccountNameCollisions()` returns `[]` when every value is unambiguous
- [ ] `findAccountNameCollisions()` flags a value matching two accounts sharing a name
- [ ] `findAccountNameCollisions()` never reports a value matching zero accounts
- [ ] `importRows()` with `accountColumn`: rows route to the correct distinct accounts
- [ ] `importRows()` with `accountColumn`: mixed valid/invalid account values (skip + report)
- [ ] `importRows()` with `accountColumn`: empty account cells (skip + report, don't throw)
- [ ] `importRows()` with `accountColumn`: an ambiguous account name throws before any row is
      created, and no transaction exists afterward for any row in that file
- [ ] `importRows()` without `accountColumn`: backward compatibility (uses `accountId`,
      `perAccountSummary` stays `undefined`)
- [ ] `importRows()` with `accountColumn`: `perAccountSummary` has correct counts/names per
      account

### End-to-End Tests (ImportPage.tsx)
- [ ] Upload a file without an account column → works exactly as before
- [ ] Upload a file with an account column → transactions split by account
- [ ] Preview shows correct resolved account names, including archived accounts
- [ ] Result shows a per-account summary when more than one account was involved
- [ ] Invalid account names in the file → reported in skipped rows, not silently dropped
- [ ] Account column with blanks → handled gracefully (skip + report)
- [ ] Two accounts sharing a name referenced in the file → Import is disabled, and if
      attempted anyway, the whole import is rejected with zero transactions created

## Acceptance Criteria

- [ ] User can select an optional "Account column" when importing
- [ ] If an account column is selected, transactions route to the accounts named per row
- [ ] If no account column is selected, all rows go to the pre-selected account (legacy
      behavior, byte-for-byte)
- [ ] Preview shows which account each row will import to, including unresolved rows
- [ ] Invalid/blank account values are reported with row numbers, never silently dropped
- [ ] An account name matching more than one existing account blocks the entire import
      (FR-006) — this is the one case that is NOT a per-row skip
- [ ] Archived accounts are valid import destinations via the account column (FR-003)
- [ ] Result shows a per-account summary when more than one account was involved
- [ ] All existing single-account import tests continue to pass unchanged
- [ ] Duplicate detection works per-account (no cross-account false positives)
- [ ] Auto-categorization works regardless of which account a row resolves to

## Rollout Plan

1. **Code Review:** Check for edge cases, error handling, type safety
2. **Testing:** Run unit + E2E tests, manual walkthrough of quickstart.md's scenarios
3. **Merge:** To development branch
4. **Docs:** Update user guide with the multi-account import section
5. **Release Notes:** Mention multi-account import feature, including the account-name
   collision requirement
6. **Monitoring:** Watch for import errors in the first week
