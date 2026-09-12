# Multi-Account Import - Architecture & Flow

> Supersedes the original draft of this document (name-or-ID matching, silent first-match on
> an ambiguous name, archived accounts excluded). Aligned with the finalized
> [spec.md](spec.md) clarifications and [plan.md](plan.md)/[research.md](research.md)/
> [data-model.md](data-model.md)/[contracts/import-account-resolution.md](contracts/import-account-resolution.md):
> matching is by name only, archived accounts are valid matches, and an account name that
> matches more than one existing account blocks the entire import rather than picking one
> silently.

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
│ 3. Fetch accounts INCLUDING archived (for resolution);      │
│    derive an active-only subset for the fallback dropdown   │
│ 4. Pre-check for account-name collisions across the file;   │
│    if any, disable Import and show which name is ambiguous  │
│ 5. Validate and show preview                                │
│    - Resolve accounts for each row                          │
│    - Show account in preview table                          │
│ 6. Call importRows() with the full account list             │
└────────────────┬────────────────────────────────────────────┘
                 │ accounts: Account[], mapping with accountColumn
                 ▼
┌─────────────────────────────────────────────────────────────┐
│         importService.ts (Backend Logic)                    │
├─────────────────────────────────────────────────────────────┤
│ importRows():                                                │
│  0. Pre-pass (NEW): findAccountNameCollisions() over the     │
│     file's distinct account values; throw before any row is  │
│     processed if any name matches more than one account      │
│  For each row:                                              │
│   1. Parse date, amount, description                        │
│   2. Resolve account (NEW: call resolveAccountForRow())     │
│   3. Check duplicates (within same account)                 │
│   4. Auto-categorize                                        │
│   5. Create transaction                                     │
│   6. Track per-account summary                              │
│                                                              │
│ resolveAccountForRow() (NEW function):                      │
│  1. Trim whitespace; blank → null                            │
│  2. Case-insensitive name match against ALL accounts passed  │
│     in, including archived ones                              │
│  3. Return Account or null (no ID-based fallback — see       │
│     research.md §6: account ids are opaque UUIDs a source    │
│     file would not realistically carry)                      │
│                                                               │
│ findAccountNameCollisions() (NEW function):                 │
│  For each distinct value referenced in the file, count how   │
│  many accounts share that name (case-insensitive); return    │
│  the values that match more than one — used as a whole-file  │
│  pre-pass, not a per-row check                                │
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
│ Account (fallback):        Checking ▼  │ (used only if accountColumn is not set)
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
  accountId: "acc-checking",           // fallback, only used when accountColumn is unset
  accountColumn: "Account",             // NEW: read from file
  dateColumn: "Date",
  dateFormat: "MM/DD/YYYY",
  amountColumn: "Amount",
  descriptionColumn: "Description",
  amountSignConvention: "negative-is-expense"
}
```

### Step 3: Pre-Pass Collision Check (NEW, runs before any row is previewed as importable)
```
Distinct account-column values across the file: ["Checking", "Savings"]

findAccountNameCollisions(["Checking", "Savings"], allAccounts):
  "Checking" → matches 1 account  → not a collision
  "Savings"  → matches 1 account  → not a collision
  → [] (no collisions, safe to proceed)

If the user's accounts happened to include TWO accounts both named "Checking"
(the app does not prevent this today — see data-model.md's "Known pre-existing
constraint"):
  "Checking" → matches 2 accounts → collision
  → ["Checking"]
  → Import button disabled; UI shows:
     "Account name 'Checking' matches more than one account. Rename one of them
      and try again."
  → Zero transactions created for this file, even for rows referencing "Savings"
```

### Step 4: Preview with Account Resolution
```
For each preview row (only reached once Step 3 finds no collisions):

Row 1:
{
  Date: "09/01",
  Amount: "-45.50",
  Description: "Grocery",
  Account: "Checking"
}
  │
  │ resolveAccountForRow("Checking", allAccounts)   // allAccounts includes archived
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
  │ resolveAccountForRow("InvalidBank", allAccounts)
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

### Step 5: Import Processing
```
importRows(key, rows, mapping, accounts):

0. Pre-pass: findAccountNameCollisions() over all distinct account values in `rows`.
   If any name is ambiguous, throw immediately — no row below is processed.

For row 1 {Date: "09/01", Amount: "-45.50", Account: "Checking"}:
  1. Parse date: "09/01" → "2025-09-01" ✅
  2. Parse amount: "-45.50" → -4550 (paise) ✅
  3. Resolve account: resolveAccountForRow("Checking", accounts) → "acc-checking" ✅
     (archived accounts are equally eligible matches here)
  4. Check duplicates: (amount, date, accountId) → none, using THIS account's own
     lazily-built duplicate index (research.md §4) ✅
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
  3. Resolve account: resolveAccountForRow("InvalidBank", accounts) → null ❌
  4. Skip row: skippedMalformedRows.push({
       rowNumber: 5,
       reason: "Account \"InvalidBank\" not found."
     })

After all rows: recalculateAccountBalance() once per DISTINCT touched account id
(research.md §5), not once per row and not just for mapping.accountId.

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

### Step 6: Result Summary
```
ImportResult:
{
  createdCount: 3,
  skippedMalformedRows: [
    { rowNumber: 5, reason: 'Account "InvalidBank" not found.' }
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
│ • Row 5: Account "InvalidBank" not  │
│          found.                      │
│                                       │
│ [Go to review queue →]              │
└──────────────────────────────────────┘
```

## Component Architecture

### importService.ts
```typescript
// NEW: Account resolution — name only, no ID fallback (research.md §6)
function resolveAccountForRow(
  value: string,            // raw cell value from the file
  accounts: Account[]       // ALL accounts, including archived (research.md §2)
): Account | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  return (
    accounts.find(a => a.name.trim().toLowerCase() === trimmed.toLowerCase()) ?? null
  );
}

// NEW: Whole-file collision pre-pass (FR-006) — the app does not enforce unique
// account names today, so this feature must detect the ambiguity itself rather
// than assume it can't occur.
function findAccountNameCollisions(
  values: string[],
  accounts: Account[]
): string[] {
  const distinct = [...new Set(
    values.map(v => v.trim()).filter(Boolean)
  )];
  return distinct.filter(value => {
    const matches = accounts.filter(
      a => a.name.trim().toLowerCase() === value.toLowerCase()
    );
    return matches.length > 1;
  });
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
    flaggedDuplicates: []
    // perAccountSummary populated below, only when accountColumn is used
  };

  // Pre-pass (NEW, FR-006): block the ENTIRE import — not just the affected rows —
  // if any account name referenced in the file is ambiguous. Runs before any
  // transaction is created, mirroring the existing MAX_IMPORT_ROWS pre-check.
  if (mapping.accountColumn) {
    const distinctValues = rows
      .map(r => r[mapping.accountColumn!]?.trim())
      .filter((v): v is string => !!v);
    const collisions = findAccountNameCollisions(distinctValues, accounts);
    if (collisions.length > 0) {
      throw new Error(
        `Account name "${collisions[0]}" matches more than one account. ` +
          `Rename one of them and try again.`
      );
    }
  }

  // Per-account duplicate index, built lazily the first time a row resolves to
  // that account (research.md §4) — NOT one shared index, and not built eagerly
  // for every account regardless of whether the file references it.
  const duplicateIndexes = new Map<string, Map<string, string>>();
  const touchedAccountIds = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;

    // Resolve account (NEW LOGIC)
    let txAccountId: string;
    if (mapping.accountColumn) {
      const rawValue = row[mapping.accountColumn] ?? '';
      if (!rawValue.trim()) {
        result.skippedMalformedRows.push({
          rowNumber,
          reason: 'Account column is empty.'
        });
        continue;
      }
      const resolved = resolveAccountForRow(rawValue, accounts);
      if (!resolved) {
        result.skippedMalformedRows.push({
          rowNumber,
          reason: `Account "${rawValue.trim()}" not found.`
        });
        continue;
      }
      txAccountId = resolved.id;
    } else {
      txAccountId = mapping.accountId;
    }

    // ... rest of existing logic (parse date, amount, etc.), using
    // duplicateIndexes.get(txAccountId) / lazily building it as in research.md §4

    // Create transaction (now with potentially different account per row)
    const tx = await TransactionEngine.recordTransaction(key, {
      accountId: txAccountId,  // Use resolved account or fallback
      // ... other fields
    });
    touchedAccountIds.add(txAccountId);

    result.createdCount++;

    // Track per-account summary (NEW) — only meaningful once accountColumn is used
    if (mapping.accountColumn) {
      result.perAccountSummary ??= {};
      const accountName = accounts.find(a => a.id === txAccountId)?.name ?? txAccountId;
      const entry = (result.perAccountSummary[txAccountId] ??= { count: 0, accountName });
      entry.count++;
    }
  }

  // Recalculate balance once per touched account, not once per row and not just
  // for mapping.accountId (research.md §5).
  for (const accountId of touchedAccountIds) {
    await TransactionEngine.recalculateAccountBalance(key, accountId);
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

  // Load accounts — NOW including archived (research.md §2), since archived
  // accounts are valid targets for column-based resolution (FR-003), even though
  // they must stay excluded from the plain fallback dropdown below.
  useEffect(() => {
    void AccountRepository.list(key, true).then(setAccounts);
  }, []);
  const activeAccounts = accounts.filter(a => !a.isArchived);

  // Collision check (NEW, FR-006) — recomputed whenever the parsed file or the
  // account column selection changes.
  const collisions = accountColumn && parsed
    ? findAccountNameCollisions(
        parsed.rows.map(r => r[accountColumn] ?? ''),
        accounts
      )
    : [];

  // Validation logic (UPDATED)
  const canImport =
    !!parsed &&
    !!dateColumn &&
    !!dateFormat &&
    collisions.length === 0 &&                                   // NEW
    (accountColumn ? true : !!accountId) &&  // NEW: require accountId only if no accountColumn
    (signConvention === 'negative-is-expense' ? !!amountColumn : !!debitColumn && !!creditColumn);

  // Preview with account resolution (UPDATED — name-only, includes archived)
  function resolveAccountPreview(row: Record<string, string>): string {
    if (!accountColumn) return accounts.find(a => a.id === accountId)?.name ?? accountId;

    const resolved = resolveAccountForRow(row[accountColumn] ?? '', accounts);
    if (!resolved) {
      const raw = row[accountColumn]?.trim();
      return raw ? `❌ ${raw} (not found)` : '❌ Empty';
    }
    return `✅ ${resolved.name}`;
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

      {/* NEW: Collision banner — blocks Import entirely (FR-006) */}
      {collisions.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Account name "{collisions[0]}" matches more than one account. Rename one of them
          before importing.
        </div>
      )}

      {/* UPDATED: Account selector conditional rendering — fallback dropdown stays
          active-accounts-only, unchanged from today */}
      {!accountColumn && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="import-account">Account</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            {/* options built from activeAccounts, not accounts */}
          </Select>
        </div>
      )}
      {accountColumn && (
        <p className="text-xs text-muted-foreground">
          Account will be read from the '{accountColumn}' column per row (including archived
          accounts).
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
    ├─ Account-name collision pre-pass (NEW, FR-006 — runs before ANY row)
    │  └─ Error: "Account name 'X' matches more than one account." → 0 rows created
    │
    ├─ Row processing (loop)
    │  │
    │  ├─ Date parsing
    │  │  └─ Error: Skip row "Unparseable date."
    │  │
    │  ├─ Amount parsing
    │  │  └─ Error: Skip row "Unparseable or zero amount."
    │  │
    │  ├─ Account resolution (NEW)
    │  │  ├─ Account column empty
    │  │  │  └─ Error: Skip row "Account column is empty."
    │  │  └─ Account not found
    │  │     └─ Error: Skip row "Account \"XYZ\" not found."
    │  │
    │  ├─ Duplicate detection (per resolved account)
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
- No per-account summary shown (perAccountSummary stays undefined)
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
- Account: (not required; ignored when accountColumn is set)

Behavior:
- mapping.accountColumn = "Account"
- Each row routed to its specified account (name match, archived accounts included)
- A file-wide collision check runs first; if any referenced name is ambiguous, the
  whole import is blocked (FR-006) instead of guessing
- Per-account summary shown
- New feature enabled ✅
```
