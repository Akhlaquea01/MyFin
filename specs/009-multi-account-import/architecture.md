# Multi-Account Import - Architecture & Flow

## System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     User                                    │
└────────────────┬────────────────────────────────────────────┘
                 │ Uploads CSV with Account column
                 ▼
┌─────────────────────────────────────────────────────────────┐
│            ImportPage (Frontend)                            │
├─────────────────────────────────────────────────────────────┤
│ 1. Parse file (CSV/XLSX)                                    │
│ 2. Show column mapping UI (NEW: Account column selector)   │
│ 3. Validate and show preview                                │
│    - Resolve accounts for each row                          │
│    - Show account in preview table                          │
│ 4. Call importRows() with account list                      │
└────────────────┬────────────────────────────────────────────┘
                 │ accounts: Account[], mapping with accountColumn
                 ▼
┌─────────────────────────────────────────────────────────────┐
│         importService.ts (Backend Logic)                    │
├─────────────────────────────────────────────────────────────┤
│ importRows():                                                │
│  For each row:                                              │
│   1. Parse date, amount, description                        │
│   2. Resolve account (NEW: call resolveAccount())           │
│   3. Check duplicates (within same account)                 │
│   4. Auto-categorize                                        │
│   5. Create transaction                                     │
│   6. Track per-account summary                              │
│                                                              │
│ resolveAccount() (NEW function):                            │
│  1. Trim whitespace                                         │
│  2. Try name match (case-insensitive)                       │
│  3. Try ID match (exact)                                    │
│  4. Return Account or null                                  │
└────────────────┬────────────────────────────────────────────┘
                 │ ImportResult with perAccountSummary
                 ▼
┌─────────────────────────────────────────────────────────────┐
│         Transaction Repository                             │
├─────────────────────────────────────────────────────────────┤
│ Create transactions in database                             │
│ (same as existing, no changes needed)                       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│            Result Display (Frontend)                        │
├─────────────────────────────────────────────────────────────┤
│ Show:                                                        │
│  - Total created                                            │
│  - Per-account breakdown (NEW)                              │
│  - Flagged duplicates                                       │
│  - Skipped rows with reasons                                │
│  - Link to review queue                                     │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow - Multi-Account Import

### Step 1: File Selection & Parsing
```
CSV File Input:
┌──────────────────────────────────────┐
│ Date,Amount,Description,Account      │
│ 09/01,-45.50,Grocery,Checking        │
│ 09/02,3500,Salary,Checking           │
│ 09/03,-200,ATM,Savings               │
└──────────────────────────────────────┘
         │
         │ parseCsv() or parseXlsx()
         ▼
ParsedFile:
{
  headers: ["Date", "Amount", "Description", "Account"],
  rows: [
    { Date: "09/01", Amount: "-45.50", Description: "Grocery", Account: "Checking" },
    { Date: "09/02", Amount: "3500", Description: "Salary", Account: "Checking" },
    { Date: "09/03", Amount: "-200", Description: "ATM", Account: "Savings" }
  ]
}
```

### Step 2: Column Mapping Configuration
```
User Selection (ImportPage):
┌────────────────────────────────────────┐
│ Account (fallback):        Checking ▼  │ (used if accountColumn empty)
│ Account column (optional): Account  ▼  │ (NEW: reads per-row account)
│ Date column:               Date     ▼  │
│ Date format:               MM/DD/YYYY  │
│ Amount column:             Amount   ▼  │
│ Description column:        Description▼│
└────────────────────────────────────────┘
         │
         │ createMapping()
         ▼
ColumnMapping:
{
  accountId: "acc-checking",           // fallback
  accountColumn: "Account",             // NEW: read from file
  dateColumn: "Date",
  dateFormat: "MM/DD/YYYY",
  amountColumn: "Amount",
  descriptionColumn: "Description",
  amountSignConvention: "negative-is-expense"
}
```

### Step 3: Preview with Account Resolution
```
For each preview row:

Row 1:
{
  Date: "09/01",
  Amount: "-45.50",
  Description: "Grocery",
  Account: "Checking"
}
  │
  │ resolveAccount("Checking", allAccounts)
  ▼
{
  accountId: "acc-checking",
  accountName: "Checking",
  status: "✅ resolved"
}
  │
  │ Show in preview table
  ▼
Preview Table Row:
│ 09/01 │ -45.50 │ Grocery │ ✅ Checking │

Row 4 (invalid):
{
  Account: "InvalidBank"
}
  │
  │ resolveAccount("InvalidBank", allAccounts)
  ▼
{
  accountId: null,
  status: "❌ not found"
}
  │
  │ Show in preview table
  ▼
Preview Table Row:
│ 09/04 │ ... │ ... │ ❌ InvalidBank (not found) │
```

### Step 4: Import Processing
```
importRows(key, rows, mapping, accounts):

For row 1 {Date: "09/01", Amount: "-45.50", Account: "Checking"}:
  1. Parse date: "09/01" → "2025-09-01" ✅
  2. Parse amount: "-45.50" → -4550 (paise) ✅
  3. Resolve account: "Checking" → "acc-checking" ✅
  4. Check duplicates: (amount, date, accountId) → none ✅
  5. Resolve merchant: "Grocery" → merchant-id ✅
  6. Create transaction:
     Transaction {
       id: "tx-1",
       accountId: "acc-checking",
       amount: -4550,
       date: "2025-09-01",
       notes: "Grocery",
       type: "expense",
       ...
     }
  7. Track: perAccountSummary["acc-checking"].count++

For row 4 {Account: "InvalidBank"}:
  1-2. (parse OK)
  3. Resolve account: "InvalidBank" → null ❌
  4. Skip row: skippedMalformedRows.push({
       rowNumber: 5,
       reason: "Account 'InvalidBank' not found"
     })

perAccountSummary after all rows:
{
  "acc-checking": {
    count: 2,
    accountName: "Checking"
  },
  "acc-savings": {
    count: 1,
    accountName: "Savings"
  }
}
```

### Step 5: Result Summary
```
ImportResult:
{
  createdCount: 3,
  skippedMalformedRows: [
    { rowNumber: 5, reason: "Account 'InvalidBank' not found" }
  ],
  flaggedDuplicates: [],
  perAccountSummary: {
    "acc-checking": { count: 2, accountName: "Checking" },
    "acc-savings": { count: 1, accountName: "Savings" }
  }
}

Display to user:
┌──────────────────────────────────────┐
│ ✅ Imported 3 transactions            │
│                                       │
│ Imported by account:                 │
│ • 2 to Checking                      │
│ • 1 to Savings                       │
│                                       │
│ 1 row skipped:                       │
│ • Row 5: Account 'InvalidBank' not  │
│          found                       │
│                                       │
│ [Go to review queue →]              │
└──────────────────────────────────────┘
```

## Component Architecture

### importService.ts
```typescript
// NEW: Account resolution
async function resolveAccount(
  identifier: string,      // from CSV
  accounts: Account[]      // loaded from DB
): Promise<Account | null> {
  identifier = identifier.trim();
  
  // Try name match first (user-friendly)
  const byName = accounts.find(a => 
    a.name.toLowerCase() === identifier.toLowerCase()
  );
  if (byName) return byName;
  
  // Try ID match (for power users)
  const byId = accounts.find(a => a.id === identifier);
  if (byId) return byId;
  
  return null;
}

// UPDATED: importRows logic
export async function importRows(
  key: CryptoKey,
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  accounts: Account[] = []  // NEW: add accounts parameter
): Promise<ImportResult> {
  const result: ImportResult = {
    createdCount: 0,
    skippedMalformedRows: [],
    flaggedDuplicates: [],
    perAccountSummary: {}  // NEW: track per-account
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;

    // Resolve account (NEW LOGIC)
    let txAccountId: string;
    if (mapping.accountColumn && mapping.accountColumn in row) {
      const accountIdentifier = row[mapping.accountColumn]?.trim();
      if (!accountIdentifier) {
        result.skippedMalformedRows.push({
          rowNumber,
          reason: 'Account column is empty'
        });
        continue;
      }
      
      const resolved = await resolveAccount(accountIdentifier, accounts);
      if (!resolved) {
        result.skippedMalformedRows.push({
          rowNumber,
          reason: `Account '${accountIdentifier}' not found`
        });
        continue;
      }
      txAccountId = resolved.id;
    } else {
      txAccountId = mapping.accountId;
    }

    // ... rest of existing logic (parse date, amount, etc.)
    
    // Create transaction (now with potentially different account per row)
    const tx = await TransactionEngine.recordTransaction(key, {
      accountId: txAccountId,  // Use resolved account or fallback
      // ... other fields
    });

    result.createdCount++;
    
    // Track per-account summary (NEW)
    if (!result.perAccountSummary) {
      result.perAccountSummary = {};
    }
    const accountName = accounts.find(a => a.id === txAccountId)?.name ?? txAccountId;
    if (!result.perAccountSummary[txAccountId]) {
      result.perAccountSummary[txAccountId] = { count: 0, accountName };
    }
    result.perAccountSummary[txAccountId].count++;
  }

  return result;
}
```

### ImportPage.tsx
```typescript
export function ImportPage() {
  // ... existing state ...
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountColumn, setAccountColumn] = useState('');  // NEW
  
  // Load accounts
  useEffect(() => {
    void AccountRepository.list(key, false).then(setAccounts);
  }, []);

  // Validation logic (UPDATED)
  const canImport =
    !!parsed &&
    !!dateColumn &&
    !!dateFormat &&
    (accountColumn ? true : !!accountId) &&  // NEW: require accountId only if no accountColumn
    (signConvention === 'negative-is-expense' ? !!amountColumn : !!debitColumn && !!creditColumn);

  // Preview with account resolution (UPDATED)
  function resolveAccountPreview(row: Record<string, string>): string {
    if (!accountColumn) return accounts.find(a => a.id === accountId)?.name ?? accountId;
    
    const identifier = row[accountColumn]?.trim();
    if (!identifier) return '❌ Empty';
    
    const account = accounts.find(a => 
      a.name.toLowerCase() === identifier.toLowerCase() || a.id === identifier
    );
    return account ? `✅ ${account.name}` : `❌ ${identifier} (not found)`;
  }

  // Import call (UPDATED)
  async function handleImport() {
    // ... validation ...
    const mapping: ColumnMapping = {
      // ... existing fields ...
      accountColumn: accountColumn || undefined,  // NEW: include if selected
    };

    const importResult = await importRows(key, parsed.rows, mapping, accounts);  // NEW: pass accounts
    // ... rest of existing logic ...
  }

  return (
    <div>
      {/* ... existing UI ... */}
      
      {/* NEW: Account column selector */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="import-account-col">Account column (optional)</Label>
        <Select value={accountColumn} onValueChange={setAccountColumn}>
          <SelectTrigger id="import-account-col" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">None - use selected account</SelectItem>
            {parsed?.headers.map((h) => (
              <SelectItem key={h} value={h}>{h}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* UPDATED: Account selector conditional rendering */}
      {!accountColumn && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-account">Account</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            {/* ... options ... */}
          </Select>
        </div>
      )}
      {accountColumn && (
        <p className="text-xs text-muted-foreground">
          Account will be read from the '{accountColumn}' column per row.
        </p>
      )}

      {/* UPDATED: Preview table with account column */}
      <Table>
        <TableHeader>
          <TableRow>
            {parsed.headers.map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
            {accountColumn && <TableHead>Account (Resolved)</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {previewRows(parsed).map((row, i) => (
            <TableRow key={i}>
              {parsed.headers.map((h) => (
                <TableCell key={h}>{row[h]}</TableCell>
              ))}
              {accountColumn && (
                <TableCell>{resolveAccountPreview(row)}</TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* UPDATED: Result with per-account summary */}
      {result?.perAccountSummary && Object.keys(result.perAccountSummary).length > 1 && (
        <div className="mt-3 text-sm">
          <p className="font-medium mb-2">Imported by account:</p>
          <ul className="list-inside list-disc">
            {Object.entries(result.perAccountSummary).map(([, summary]) => (
              <li key={summary.accountName}>
                {summary.count} to {summary.accountName}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

## Error Handling Flow

```
Import Process
    │
    ├─ File parsing
    │  └─ Error: "Invalid CSV/XLSX format"
    │
    ├─ Column validation
    │  └─ Error: "Date column not found in headers"
    │
    ├─ Row processing (loop)
    │  │
    │  ├─ Date parsing
    │  │  └─ Error: Skip row "Unparseable date"
    │  │
    │  ├─ Amount parsing
    │  │  └─ Error: Skip row "Unparseable or zero amount"
    │  │
    │  ├─ Account resolution (NEW)
    │  │  ├─ Account column empty
    │  │  │  └─ Error: Skip row "Account column is empty"
    │  │  └─ Account not found
    │  │     └─ Error: Skip row "Account 'XYZ' not found"
    │  │
    │  ├─ Duplicate detection
    │  │  └─ Flag as duplicate (still create)
    │  │
    │  └─ Transaction creation
    │     └─ Success: increment count, add to summary
    │
    └─ Return ImportResult
       └─ Display: created count + per-account breakdown + errors
```

## Backward Compatibility

```
OLD: No account column in CSV
┌────────────────┐
│ Date | Amount  │
├────────────────┤
│ 09/01 │ -45.50 │
└────────────────┘

User config:
- Account column: (not selected)
- Account: Checking

Behavior:
- mapping.accountColumn = undefined
- All rows use mapping.accountId
- No per-account summary shown (or only one account)
- Works exactly as before ✅

NEW: Account column in CSV
┌──────────────────────────┐
│ Date | Amount | Account   │
├──────────────────────────┤
│ 09/01 │ -45.50 │ Checking  │
│ 09/02 │ 100    │ Savings   │
└──────────────────────────┘

User config:
- Account column: Account
- Account: (grayed out, not used)

Behavior:
- mapping.accountColumn = "Account"
- Each row routed to its specified account
- Per-account summary shown
- New feature enabled ✅
```
