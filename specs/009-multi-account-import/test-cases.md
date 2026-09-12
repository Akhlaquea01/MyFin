# Multi-Account Import - Test Cases & Examples

> Updated to match the finalized [spec.md](spec.md) clarifications: matching is by name only
> (Test Case 5 below replaces the earlier "Account ID Lookup" case, which described a matching
> path this feature does not implement), archived accounts are valid matches (Test Case 11),
> and an account name shared by two accounts blocks the entire import rather than picking one
> silently (Test Case 12 / Scenario D). See [quickstart.md](quickstart.md) for the authoritative
> end-to-end scenarios; this file's CSV examples are illustrative test data, not a spec.

## Test Data Files

### Test Case 1: Multi-Account with Valid Data
**File:** `test_multi_account_valid.csv`

```csv
Date,Description,Amount,Account
2025-09-01,Grocery Store,-45.50,Checking
2025-09-02,Paycheck,3500.00,Checking
2025-09-03,ATM Withdrawal,-200.00,Savings
2025-09-04,Interest Earned,0.05,Savings
2025-09-05,Credit Card Payment,-1000.00,Checking
```

**Expected Result:**
- ✅ Created 5 transactions
- ✅ Checking: 3 transactions
- ✅ Savings: 2 transactions
- ✅ No duplicates detected
- ✅ All categorized based on merchant

**Per-Account Summary:**
```
Checking: 3 (paycheck, grocery, CC payment)
Savings: 2 (withdrawal, interest)
```

---

### Test Case 2: Mixed Valid/Invalid Accounts
**File:** `test_multi_account_invalid.csv`

```csv
Date,Description,Amount,Account
2025-09-01,Grocery,-45.50,Checking
2025-09-02,Salary,3500.00,Checking
2025-09-03,ATM Withdrawal,-200,Savings
2025-09-04,Transfer,-500,TransitAccount
2025-09-05,Interest,0.05,Savings
```

**Assumptions:**
- Accounts exist: "Checking", "Savings"
- Account does NOT exist: "TransitAccount"

**Expected Result:**
- ✅ Created 4 transactions
- ✅ Skipped 1 row (row 5, TransitAccount not found)
- ✅ Checking: 2 transactions
- ✅ Savings: 2 transactions
- ❌ Skipped rows report:
  ```
  Row 5: Account "TransitAccount" not found.
  ```

---

### Test Case 3: Empty Account Column Cells
**File:** `test_empty_account_cells.csv`

```csv
Date,Description,Amount,Account
2025-09-01,Grocery,-45.50,Checking
2025-09-02,Salary,3500.00,
2025-09-03,ATM Withdrawal,-200,Savings
2025-09-04,Interest,0.05,Savings
```

**Expected Result:**
- ✅ Created 3 transactions
- ❌ Skipped 1 row (row 3, empty account)
- ✅ Checking: 1 transaction
- ✅ Savings: 2 transactions
- Skipped rows report:
  ```
  Row 3: Account column is empty.
  ```

---

### Test Case 4: Case-Insensitive Account Names
**File:** `test_case_insensitive.csv`

```csv
Date,Description,Amount,Account
2025-09-01,Grocery,-45.50,CHECKING
2025-09-02,Salary,3500.00,checking
2025-09-03,ATM Withdrawal,-200,ChEcKiNg
2025-09-04,Interest,0.05,SAVINGS
```

**Assumptions:**
- Account exists: "Checking" (and "Savings")

**Expected Result:**
- ✅ All 4 transactions created
- ✅ Checking: 3 (case-insensitive match works)
- ✅ Savings: 1 (case-insensitive match works)

---

### Test Case 5: Account Names Only — Not IDs

**File:** `test_account_id_not_matched.csv`

```csv
Date,Description,Amount,Account
2025-09-01,Grocery,-45.50,acc-001
2025-09-02,Salary,3500.00,acc-001
```

**Assumptions:**
- No account is actually *named* "acc-001" — that string is only an internal account id,
  never shown to the user anywhere in the app.

**Expected Result:**
- ❌ Both rows skipped: `Account "acc-001" not found.`
- ✅ Confirms matching is name-only (research.md §6) — a value that happens to look like an
  id is not specially resolved, since account ids are opaque UUIDs a real source file would
  never realistically contain.

*(This case replaces an earlier draft of this document, which incorrectly assumed ID-based
matching would be supported for "power users".)*

---

### Test Case 6: Whitespace Trimming
**File:** `test_whitespace.csv`

```csv
Date,Description,Amount,Account
2025-09-01,Grocery,-45.50, Checking 
2025-09-02,Salary,3500.00,  Checking  
2025-09-03,ATM Withdrawal,-200,Savings
```

**Expected Result:**
- ✅ All 3 transactions created
- ✅ Whitespace trimmed from account names
- ✅ Checking: 2 (whitespace normalized)
- ✅ Savings: 1

---

### Test Case 7: No Account Column (Backward Compatibility)
**File:** `test_no_account_column.csv`

```csv
Date,Description,Amount
2025-09-01,Grocery,-45.50
2025-09-02,Salary,3500.00
2025-09-03,Utility Bill,-120
```

**User Config:**
- Account column: None (not selected)
- Account (fallback): "Checking" (required)

**Expected Result:**
- ✅ All 3 transactions created
- ✅ All assigned to "Checking" (legacy behavior)
- ✅ No account column required in file
- ✅ Result shows single account (no per-account breakdown; `perAccountSummary` is
  `undefined`)

---

### Test Case 8: Duplicate Detection Per-Account
**File:** `test_duplicates_same_account.csv`

```csv
Date,Description,Amount,Account
2025-09-01,Grocery,-45.50,Checking
2025-09-01,Grocery Store,-45.50,Checking
2025-09-02,Salary,3500.00,Checking
2025-09-02,Paycheck,3500.00,Checking
```

**Expected Result:**
- ✅ Created 4 transactions (all unreviewed)
- ✅ Flagged 2 as possible duplicates (rows 3 and 4)
- ✅ Duplicates detected within same account

---

### Test Case 9: Duplicates Across Accounts (Not Flagged)
**File:** `test_duplicates_different_accounts.csv`

```csv
Date,Description,Amount,Account
2025-09-01,Grocery,-45.50,Checking
2025-09-01,Grocery Store,-45.50,Savings
2025-09-02,Salary,3500.00,Checking
2025-09-02,Paycheck,3500.00,Savings
```

**Expected Result:**
- ✅ Created 4 transactions
- ✅ NO duplicates flagged (same amount/date but different accounts)
- ✅ Correct: they're on different accounts, not duplicates

---

### Test Case 10: Complex Real-World Bank Export
**File:** `test_bank_export_multi_account.csv`

```csv
Transaction Date,Description,Debit,Credit,Account
09/01/2025,OPENING BALANCE,,5000.00,Checking
09/01/2025,GROCERY STORE,45.50,,Checking
09/02/2025,PAYROLL,3500.00,,Checking
09/03/2025,ATM WITHDRAWAL,200.00,,Checking
09/03/2025,TRANSFER TO SAVINGS,500.00,,Checking
09/04/2025,ATM DEPOSIT,,500.00,Savings
09/04/2025,TRANSFER FROM CHECKING,,500.00,Savings
09/05/2025,SAVINGS INTEREST,,0.05,Savings
```

**User Config:**
- Date column: "Transaction Date"
- Date format: "MM/DD/YYYY"
- Amount convention: Separate debit/credit columns
- Debit column: "Debit"
- Credit column: "Credit"
- Account column: "Account"

**Expected Result:**
- ✅ Created 8 transactions total
- ✅ Checking: 4 transactions
- ✅ Savings: 4 transactions
- ✅ All amounts properly signed (debit/credit resolved)
- ✅ Possible duplicates: rows 6-7 (transfer pair, but on different accounts so NOT flagged)

**Per-Account Summary:**
```
Checking: 4 (opening, grocery, payroll, withdrawal)
Savings: 4 (atm deposit, transfer, transfer, interest)
```

---

### Test Case 11: Archived Account is a Valid Destination (FR-003)
**File:** `test_archived_account.csv`

```csv
Date,Description,Amount,Account
2025-09-01,Old Wallet Cleanup,-10.00,Old Wallet
```

**Assumptions:**
- "Old Wallet" exists but has been archived via Accounts → Archive.

**Expected Result:**
- ✅ Row imports successfully into "Old Wallet" — archived accounts are eligible matches for
  column-based resolution (unlike the plain fallback "Account" dropdown, which still excludes
  archived accounts).

---

### Test Case 12: Duplicated Account Name Blocks the Whole Import (FR-006)
**File:** `test_duplicate_account_name.csv`

```csv
Date,Description,Amount,Account
2025-09-01,Grocery,-45.50,Checking
2025-09-02,ATM,-200.00,Savings
```

**Assumptions:**
- The user has TWO accounts both named "Checking" (the app does not prevent this today — see
  data-model.md's "Known pre-existing constraint").

**Expected Result:**
- ❌ Created 0 transactions — for *any* row in the file, including the "Savings" row, which
  is on its own unambiguous.
- ✅ The UI states that "Checking" matches more than one account and blocks Import before the
  user can even attempt it; if attempted via a direct `importRows()` call, it throws with the
  same message before processing any row.
- After renaming one of the two "Checking" accounts and retrying with the same file, the
  import proceeds normally.

---

## Edge Case Scenarios

### Scenario A: All Accounts Invalid
**File:**
```csv
Date,Description,Amount,Account
2025-09-01,Grocery,-45.50,InvalidBank
2025-09-02,Salary,3500.00,FakeAccount
```

**Expected:**
- ❌ Created 0 transactions
- ✅ Skipped 2 rows
- Errors:
  ```
  Row 2: Account "InvalidBank" not found.
  Row 3: Account "FakeAccount" not found.
  ```

---

### Scenario B: Account Column but All Blanks
**File:**
```csv
Date,Description,Amount,Account
2025-09-01,Grocery,-45.50,
2025-09-02,Salary,3500.00,
```

**User Config:**
- Account column: "Account"
- Account (fallback): "Checking" (selected but not used since column specified)

**Expected:**
- ❌ Created 0 transactions
- ✅ Skipped 2 rows (account column empty on both)
- Errors:
  ```
  Row 2: Account column is empty.
  Row 3: Account column is empty.
  ```

---

### Scenario C: Account Column with Mixed Validity
**File:**
```csv
Date,Description,Amount,Account
2025-09-01,Grocery,-45.50,Checking
2025-09-02,Salary,3500.00,
2025-09-03,ATM Withdrawal,-200,Savings
2025-09-04,Transfer,-500,CreditCard
2025-09-05,Interest,0.05,Savings
```

**Expected:**
- ✅ Created 4 transactions
- ❌ Skipped 1 row (row 4, CreditCard doesn't exist)
- ✅ Checking: 1
- ✅ Savings: 2
- ❌ Skipped 1 (blank) + 1 (not found)

---

### Scenario D: Collision Affects Only Some Rows, Still Blocks Everything
**File:**
```csv
Date,Description,Amount,Account
2025-09-01,Grocery,-45.50,Checking
2025-09-02,ATM,-200.00,Savings
2025-09-03,Salary,3500.00,Checking
```

**Assumptions:**
- Two accounts are both named "Checking"; "Savings" is unambiguous.

**Expected:**
- ❌ Created 0 transactions — including row 3 (Savings), which on its own would have imported
  fine. FR-006 blocks the entire file, not just the rows naming "Checking" (see data-model.md
  and research.md §3 for why this is a whole-file pre-pass rather than a per-row check).

---

## Unit Test Cases (Code Level)

### resolveAccountForRow() Function

**Test 1: Exact name match**
```typescript
it('should match account by exact name', () => {
  const accounts = [{ id: '1', name: 'Checking', isArchived: false } as Account];
  const result = resolveAccountForRow('Checking', accounts);
  expect(result?.id).toBe('1');
});
```

**Test 2: Case-insensitive name match**
```typescript
it('should match account by name (case-insensitive)', () => {
  const accounts = [{ id: '1', name: 'Checking', isArchived: false } as Account];
  const result = resolveAccountForRow('checking', accounts);
  expect(result?.id).toBe('1');
});
```

**Test 3: Whitespace trimming**
```typescript
it('should trim whitespace', () => {
  const accounts = [{ id: '1', name: 'Checking', isArchived: false } as Account];
  const result = resolveAccountForRow('  Checking  ', accounts);
  expect(result?.id).toBe('1');
});
```

**Test 4: Not found**
```typescript
it('should return null if account not found', () => {
  const accounts = [{ id: '1', name: 'Checking', isArchived: false } as Account];
  const result = resolveAccountForRow('NonExistent', accounts);
  expect(result).toBeNull();
});
```

**Test 5: Blank value**
```typescript
it('should return null for a blank value without matching anything', () => {
  const accounts = [{ id: '1', name: 'Checking', isArchived: false } as Account];
  const result = resolveAccountForRow('   ', accounts);
  expect(result).toBeNull();
});
```

**Test 6: Archived account matches like any other (FR-003)**
```typescript
it('should match an archived account the same as an active one', () => {
  const accounts = [{ id: '1', name: 'Old Wallet', isArchived: true } as Account];
  const result = resolveAccountForRow('Old Wallet', accounts);
  expect(result?.id).toBe('1');
});
```

**Test 7: Value matching an account id is NOT resolved (research.md §6)**
```typescript
it('should not match a raw account id — matching is name-only', () => {
  const accounts = [{ id: 'acc-001', name: 'Checking', isArchived: false } as Account];
  const result = resolveAccountForRow('acc-001', accounts);
  expect(result).toBeNull();
});
```

### findAccountNameCollisions() Function

**Test 8: No collisions when every name is unique**
```typescript
it('should return no collisions when account names are unique', () => {
  const accounts = [
    { id: '1', name: 'Checking', isArchived: false } as Account,
    { id: '2', name: 'Savings', isArchived: false } as Account
  ];
  expect(findAccountNameCollisions(['Checking', 'Savings'], accounts)).toEqual([]);
});
```

**Test 9: Flags a name shared by two accounts (FR-006)**
```typescript
it('should flag an account name matching more than one account', () => {
  const accounts = [
    { id: '1', name: 'Checking', isArchived: false } as Account,
    { id: '2', name: 'Checking', isArchived: false } as Account
  ];
  expect(findAccountNameCollisions(['Checking'], accounts)).toEqual(['Checking']);
});
```

**Test 10: A value matching zero accounts is not a collision**
```typescript
it('should not treat an unmatched value as a collision', () => {
  const accounts = [{ id: '1', name: 'Checking', isArchived: false } as Account];
  expect(findAccountNameCollisions(['NonExistent'], accounts)).toEqual([]);
});
```

---

## Preview Validation

### Expected Preview Display

**When account column selected:**
```
┌──────────┬────────────────┬────────┬───────────────────────┐
│ Date     │ Description    │ Amount │ Account (Resolved)    │
├──────────┼────────────────┼────────┼───────────────────────┤
│ 09/01/25 │ Grocery        │ -45.50 │ ✅ Checking           │
│ 09/02/25 │ Salary         │ 3500   │ ✅ Checking           │
│ 09/03/25 │ ATM            │ -200   │ ✅ Savings            │
│ 09/04/25 │ Transfer       │ -500   │ ❌ NotFound           │
│ 09/05/25 │ Interest       │ 0.05   │ ✅ Savings            │
└──────────┴────────────────┴────────┴───────────────────────┘
```

**When two accounts share a name referenced in the file (FR-006):**
```
┌────────────────────────────────────────────────────────────┐
│ ⚠ Account name "Checking" matches more than one account.   │
│   Rename one of them before importing.                     │
└────────────────────────────────────────────────────────────┘
[Import] ← disabled
```

**When account column NOT selected:**
```
┌──────────┬────────────────┬────────┬──────────┐
│ Date     │ Description    │ Amount │ Account  │
├──────────┼────────────────┼────────┼──────────┤
│ 09/01/25 │ Grocery        │ -45.50 │ Checking │
│ 09/02/25 │ Salary         │ 3500   │ Checking │
│ 09/03/25 │ ATM            │ -200   │ Checking │
│ 09/04/25 │ Interest       │ 0.05   │ Checking │
│ 09/05/25 │ Utilities      │ -120   │ Checking │
└──────────┴────────────────┴────────┴──────────┘
(All rows use single selected account)
```

---

## Success Metrics

After implementation, verify:
- ✅ Can import 100+ transactions with 5+ accounts in one file
- ✅ Account resolution < 100ms per 1000 rows
- ✅ Preview renders correctly with account column, including the collision banner
- ✅ Error messages clear and actionable
- ✅ No performance regression on single-account imports
- ✅ All test cases in this file, and all tasks in tasks.md, pass
