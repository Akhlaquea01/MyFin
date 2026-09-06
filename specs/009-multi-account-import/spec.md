# Multi-Account CSV/XLSX Import

**Status:** Design  
**Priority:** P3  
**User Story:** P3 (Nice-to-have enhancement)  
**Related:** FR-037, FR-038 (existing CSV/XLSX import)

## Overview

Extend the existing CSV/XLSX import feature to support optional per-row account mapping. Currently, all transactions in a single import file are assigned to one pre-selected account. This feature allows users to import transactions destined for different accounts in a single file by adding an optional "Account" column.

## Problem Statement

Users with multiple accounts (checking, savings, credit card) often need to import bulk transactions from various sources. Currently:
- Bank exports for Checking and Savings must be imported separately
- Users must split files by account before importing
- Multi-account data (e.g., consolidated statements) requires manual account assignment
- Increases friction for bulk imports and error risk from misrouting transactions

## Desired Outcomes

✅ Users can import transactions for multiple accounts in one file  
✅ Backward compatible (account column remains optional)  
✅ Clear validation and error reporting  
✅ Same duplicate detection, categorization, and review workflow as single-account imports

## Functional Requirements

### FR-041: Optional Account Column Mapping
- **What:** Users can optionally select an "Account column" when configuring column mappings
- **How:** 
  - Add "Account column (optional)" dropdown to import configuration
  - If selected, read account name/ID from each row
  - If not selected, use legacy behavior (single pre-selected account)
- **Input validation:**
  - Account column values must match an existing account name
  - If account doesn't exist, skip row with reason "Account not found"
  - Empty/blank account cells treated as error
- **UI feedback:** 
  - Show in preview which account each row will import to
  - Report account resolution errors in import result

### FR-042: Account Resolution
- **Lookup:** Match account column value against:
  - Account names (case-insensitive)
  - Account IDs (exact match)
- **Fallback:** Try name match first, then ID
- **Error handling:** 
  - Row rejected if account cannot be resolved
  - Reported in `skippedMalformedRows` with reason "Account 'XYZ' not found"

### FR-043: Transfer Transaction Support
- **Recognition:** If a row has special markers in description, optionally create as transfer:
  - Description contains "transfer" keyword (case-insensitive)
  - Special prefix like `[TRANSFER]` or `->` 
  - Not required; can be regular expense/income if user prefers
- **Behavior:** 
  - Regular flow: amount on specified account (negative = expense)
  - For now: let user create transfers manually if needed (keep scope tight)

### FR-044: Import Result Reporting
- Update `ImportResult` to include per-account summary:
  ```typescript
  {
    createdCount: 150,
    perAccountSummary: {
      "account-id-1": { count: 50, accountName: "Checking" },
      "account-id-2": { count: 100, accountName: "Savings" }
    },
    skippedMalformedRows: [...],
    flaggedDuplicates: [...]
  }
  ```

## Data Model Changes

### ColumnMapping Interface (Update)
```typescript
export interface ColumnMapping {
  dateColumn: string;
  amountColumn: string;
  descriptionColumn?: string;
  accountColumn?: string;  // NEW: optional account column
  accountId: string;       // EXISTING: used only if accountColumn is not set
  dateFormat: string;
  amountSignConvention: 'negative-is-expense' | 'separate-debit-credit-columns';
  debitColumn?: string;
  creditColumn?: string;
}
```

### ImportResult Interface (Update)
```typescript
export interface ImportResult {
  createdCount: number;
  skippedMalformedRows: { rowNumber: number; reason: string }[];
  flaggedDuplicates: { rowNumber: number; existingTransactionId: string }[];
  perAccountSummary?: Record<string, { count: number; accountName: string }>;  // NEW
}
```

## UI/UX Changes

### ImportPage.tsx Updates

1. **New Control: Account Column Selector**
   - Add below existing account selector
   - Label: "Account column (optional)"
   - Placeholder: "None - use selected account below"
   - Options: Parsed headers + "None"
   - Help text: "If set, reads account from each row. All rows use the account selected below if this is empty."

2. **Conditional Account Selector**
   - When account column is NOT selected: Show "Account" dropdown (required)
   - When account column IS selected: Show "Account" dropdown (for fallback only, grayed out with note)
   - Note: "This account is used as fallback only when account column is empty or invalid"

3. **Preview Update**
   - Add column showing resolved account name for each row
   - Highlight rows where account couldn't be resolved
   - Show account resolution status in preview table

4. **Result Summary**
   - Show breakdown by account: "Imported 50 to Checking, 100 to Savings"
   - List which accounts received transactions

### Sample UI Layout
```
┌─────────────────────────────────────┐
│ Import Configuration                │
├─────────────────────────────────────┤
│ Account (fallback)         │ Checking ▼ │
│ Account column (optional)  │ None     ▼ │
│ Date column                │ Date     ▼ │
│ Date format                │ YYYY-MM-DD  │
│ Amount column              │ Amount   ▼ │
│ Description column         │ Notes    ▼ │
│ Amount convention          │ Single   ▼ │
└─────────────────────────────────────┘

Preview:
┌────────┬──────────┬────────┬───────────┐
│ Date   │ Amount   │ Notes  │ Account   │
├────────┼──────────┼────────┼───────────┤
│ 09-01  │ -45.50   │ Grocery│ Checking ✓│
│ 09-02  │ 3500.00  │ Salary │ Checking ✓│
│ 09-03  │ 250.00   │ Xfer   │ ??? ✗     │ (Account not found)
└────────┴──────────┴────────┴───────────┘
```

## Validation Rules

| Scenario | Behavior |
|----------|----------|
| Account column set, value matches existing account | ✅ Use that account |
| Account column set, value is blank/empty | ❌ Skip row "Account column is empty" |
| Account column set, value doesn't match any account | ❌ Skip row "Account 'XYZ' not found" |
| Account column NOT set, single account selected | ✅ Use selected account (legacy) |
| Account column NOT set, no account selected | ❌ Validation error "Choose an account" |

## Implementation Plan

### Phase 1: Backend (importService.ts)
1. Update `ColumnMapping` interface to include optional `accountColumn`
2. Create `resolveAccount()` function:
   - Input: account identifier (name or ID), encryption key, all accounts list
   - Output: account ID or null if not found
3. Update `importRows()` to:
   - Accept accounts list in parameters
   - For each row: resolve account from column or use fallback
   - Handle account resolution errors gracefully
4. Update `ImportResult` interface for per-account summary
5. Build per-account summary in import result

### Phase 2: Frontend (ImportPage.tsx)
1. Fetch accounts list (already done in `useEffect`)
2. Add "Account column" selector state
3. Add conditional UI rendering:
   - If account column selected: gray out main account picker, show fallback note
   - If not selected: require main account picker
4. Update validation logic:
   - If accountColumn: don't require accountId
   - If !accountColumn: require accountId
5. Update preview to show resolved account for each row
6. Pass accounts list to `importRows()` call
7. Display per-account summary in result card

### Phase 3: Testing
- Unit tests for `resolveAccount()` with various inputs
- Integration test: import file with multiple accounts
- Edge cases: blank cells, typos, ID lookups
- Backward compatibility: ensure single-account imports still work

## Sample Import File

```csv
Date,Description,Amount,Account
2025-09-01,Coffee,-5.50,Checking
2025-09-02,Paycheck,3500.00,Checking
2025-09-03,ATM Withdrawal,-200.00,Savings
2025-09-04,Interest,0.05,Savings
2025-09-05,CC Payment,-1000.00,Credit Card
```

Result:
```
Imported 2 to Checking, 2 to Savings, 1 to Credit Card
5 total transactions created, 0 flagged as duplicates
```

## Edge Cases & Decisions

1. **Case sensitivity:** Account names are case-insensitive match (Checking = checking = CHECKING)
2. **Whitespace:** Trim account name values before lookup
3. **Empty cells:** Treated as "account not provided" error, skip row
4. **Account IDs vs names:** Support both; name match tried first for UX
5. **Non-existent accounts:** Skip row with clear error message
6. **Fallback account:** Used only when account column is empty or invalid (future enhancement)
7. **Duplicates:** Checked per-account (same amount, date, account = possible duplicate)

## Success Criteria

- ✅ Can import CSV with "Account" column, transactions routed correctly
- ✅ Preview shows account resolution status
- ✅ Import result shows per-account summary
- ✅ Invalid accounts reported with row numbers
- ✅ Backward compatible: single-account imports unchanged
- ✅ No changes to duplicate detection, categorization, or review workflow
- ✅ Works with both debit/credit and single-amount column modes

## Future Enhancements (Out of Scope)

- Auto-detect account from transaction data (memo analysis)
- Fallback account for unresolved rows (use fallback instead of skip)
- Automatic transfer pair creation from special markers
- Account aliases ("My Checking" = "Checking Account")
- Multi-file batch import with account routing

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| User imports to wrong account by mistake | Always show preview with account column resolved |
| Typo in account name breaks import | Clear error message showing which accounts exist |
| Silent transaction loss | Report skipped rows with reasons in result |
| Backward compatibility broken | Test with single-account files; make accountColumn optional |

## Related User Stories

- FR-037, FR-038: CSV/XLSX import (existing)
- FR-020, FR-038: Duplicate detection (existing)
- FR-002, spec-006: Auto-categorization (existing)
- FR-011: Transfer between accounts (existing; can create manually after import)
