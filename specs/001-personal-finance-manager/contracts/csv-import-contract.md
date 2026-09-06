# Contract: CSV/XLSX Import & Column Mapping

Covers FR-037 (import with column mapping) and FR-038 (duplicate detection during import),
User Story 9.

## Input

Any CSV or XLSX file with a header row. The app does not assume any particular column
names or order — the user maps columns interactively.

## Column mapping object

```ts
interface ColumnMapping {
	dateColumn: string; // required — source column header
	amountColumn: string; // required
	descriptionColumn?: string; // optional — feeds merchant/notes
	accountId: string; // target account for every imported row (single-account import)
	dateFormat: string; // e.g., "DD/MM/YYYY" — required since source format is unknown
	amountSignConvention: 'negative-is-expense' | 'separate-debit-credit-columns';
	debitColumn?: string; // required if amountSignConvention is "separate-debit-credit-columns"
	creditColumn?: string; // required if amountSignConvention is "separate-debit-credit-columns"
}
```

## Preview step (before commit)

`parseCsvPreview`/equivalent returns the first N rows parsed under the current mapping so
the UI can show a preview table before the user confirms the import — this lets the user
catch a wrong date format or column choice before any data is written.

## Import result

```ts
interface ImportResult {
	createdCount: number;
	skippedMalformedRows: { rowNumber: number; reason: string }[]; // Edge Case: reported, not silently dropped
	flaggedDuplicates: { rowNumber: number; existingTransactionId: string }[]; // FR-038
}
```

- A row that fails to parse under the given mapping (unparseable date, non-numeric amount)
  is added to `skippedMalformedRows` and never silently guessed at (Edge Case in spec.md).
- A row matching the FR-020/FR-038 duplicate rule (same account, same amount, date within
  ±1 day as an existing non-deleted transaction) is created with
  `reviewStatus: 'unreviewed'` and `duplicateOfId` set, rather than being auto-merged or
  auto-discarded — the user makes the final call in the review queue (FR-022).
- All created rows from an import land in the review queue as `source: 'file_import'`,
  `reviewStatus: 'unreviewed'` (consistent with Quick Add's treatment in
  repository-interfaces.md) so the user confirms a large import before it affects budgets/
  dashboards silently.

## Bulk text import (SMS-backup-style files)

Uses the same `ImportResult` shape. Each line/record recognized by the `QuickAddParser`
(see repository-interfaces.md) becomes one candidate transaction with `source:
'bulk_import'`; unrecognized lines are reported the same way as malformed CSV rows rather
than being silently dropped (FR-021).
