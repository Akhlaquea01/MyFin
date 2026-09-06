# Multi-Account Import - Implementation Checklist

## Backend Changes (importService.ts)

### Type Updates
- [ ] Update `ColumnMapping` interface
  - [ ] Add `accountColumn?: string` field
  - [ ] Keep `accountId` for backward compatibility

- [ ] Update `ImportResult` interface
  - [ ] Add `perAccountSummary?: Record<string, { count: number; accountName: string }>`

### New Functions
- [ ] Implement `resolveAccount()`
  ```typescript
  async function resolveAccount(
    accountIdentifier: string,
    accounts: Account[]
  ): Promise<Account | null>
  ```
  - [ ] Trim whitespace from identifier
  - [ ] Try name match (case-insensitive)
  - [ ] Try ID match (exact)
  - [ ] Return null if no match

### Update importRows() Function
- [ ] Add `accounts: Account[]` parameter
- [ ] Modify account resolution logic:
  ```typescript
  let txAccountId: string;
  if (mapping.accountColumn) {
    const accountId = await resolveAccount(row[mapping.accountColumn], accounts);
    if (!accountId) {
      // Skip row with error
      continue;
    }
    txAccountId = accountId;
  } else {
    txAccountId = mapping.accountId;
  }
  ```
- [ ] Update per-row account assignment
- [ ] Build `perAccountSummary` object as transactions created
- [ ] Include `perAccountSummary` in returned result

### Validation Updates
- [ ] In `importRows()`, handle empty account column values
- [ ] Report account resolution failures in `skippedMalformedRows`

## Frontend Changes (ImportPage.tsx)

### State Management
- [ ] Add state: `const [accountColumn, setAccountColumn] = useState('')`
- [ ] Update `mapping` object to include `accountColumn`

### UI Components - Column Mapping Section
- [ ] After Account selector, add Account column selector:
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

### UI Styling - Account Selector Conditional
- [ ] When `accountColumn` is set:
  - [ ] Gray out Account selector
  - [ ] Add help text: "Account column will be used. Account below is fallback only."
- [ ] When `accountColumn` is NOT set:
  - [ ] Account selector is required
  - [ ] Validation: `canImport` checks `!!accountId || !!accountColumn`

### Preview Table Update
- [ ] Add "Account" column to preview table
- [ ] For each preview row:
  - [ ] If accountColumn: resolve account name and show it
  - [ ] If account not found: show "❌ Not found" or highlight in red
  - [ ] If no accountColumn: show the single selected account name
- [ ] Show account resolution status visually

### Handle Import Call
- [ ] Pass `accounts` array to `importRows()`:
  ```typescript
  const importResult = await importRows(key, parsed.rows, mapping, accounts);
  ```

### Result Display Update
- [ ] After successful import, display per-account summary:
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
- [ ] `resolveAccount()` with exact name match
- [ ] `resolveAccount()` with case-insensitive name match
- [ ] `resolveAccount()` with ID match
- [ ] `resolveAccount()` with non-existent account
- [ ] `resolveAccount()` with whitespace in input
- [ ] Import with accountColumn: valid accounts
- [ ] Import with accountColumn: mixed valid/invalid accounts
- [ ] Import with accountColumn: empty account cells (should skip)
- [ ] Import without accountColumn: backward compatibility (uses accountId)

### Integration Tests (ImportPage.tsx)
- [ ] Upload file without account column → works as before
- [ ] Upload file with account column → transactions split by account
- [ ] Preview shows correct account names
- [ ] Result shows per-account summary
- [ ] Invalid account names in file → reported in skipped rows
- [ ] Account column with blanks → handled gracefully

### Manual Testing
- [ ] Import checking_only.csv → all to Checking ✅
- [ ] Import multi_account.csv:
  ```
  Date,Amount,Account
  2025-09-01,-50,Checking
  2025-09-02,100,Savings
  2025-09-03,-25,Checking
  ```
  Result: 2 to Checking, 1 to Savings ✅
- [ ] Import with typo in account name → skip row, show error ✅
- [ ] Import with case variations (Checking/checking/CHECKING) → all match ✅
- [ ] Verify duplicates detected within same account ✅
- [ ] Verify review queue shows correct accounts ✅

## Acceptance Criteria

- [ ] User can select optional "Account column" when importing
- [ ] If account column selected, transactions route to specified accounts
- [ ] If account column not selected, all go to pre-selected account (legacy behavior)
- [ ] Preview shows which account each transaction will import to
- [ ] Invalid account names reported with row numbers
- [ ] Result shows per-account summary when multi-account
- [ ] All existing single-account import tests pass
- [ ] Duplicate detection works per-account
- [ ] Auto-categorization works regardless of account

## Rollout Plan

1. **Code Review:** Check for edge cases, error handling, type safety
2. **Testing:** Run unit + integration tests, manual end-to-end
3. **Merge:** To development branch
4. **Docs:** Update user guide with multi-account import section
5. **Release Notes:** Mention multi-account import feature
6. **Monitoring:** Watch for import errors in first week

## Estimated Effort

- Backend changes: 2-3 hours
- Frontend changes: 2-3 hours
- Testing: 1-2 hours
- Documentation: 30 min
- **Total: 5-8 hours**
