# Contract: Encrypted Backup File Format

This is the one true external file format the app produces and must be able to read back,
including across app versions (FR-040, FR-041, and the backup-migration clarification in
spec.md). Treat this as a versioned contract: changing the plaintext shape below is a
schema version bump, not a silent change.

## File structure (on disk)

A backup is a single JSON file:

```json
{
	"container": "personal-finance-manager-backup",
	"containerVersion": 1,
	"schemaVersion": "1.0.0",
	"createdAt": "2026-09-06T12:00:00.000Z",
	"checksum": "<sha-256 hex of the decrypted plaintext payload>",
	"kdf": { "algorithm": "PBKDF2-SHA256", "iterations": 210000, "salt": "<base64>" },
	"cipher": { "algorithm": "AES-GCM", "iv": "<base64>" },
	"ciphertext": "<base64 — AES-GCM-encrypted JSON payload>"
}
```

- `containerVersion` describes this outer envelope shape; it changes only if the envelope
  itself (not the app's data model) changes.
- `schemaVersion` describes the shape of the decrypted **payload** (see below) and follows
  the data model's own versioning.
- The encryption key is derived the same way as the live app's key: PBKDF2 over the user's
  PIN using `kdf.salt` (FR-043 — same key as the app PIN, no separate backup passphrase).

## Decrypted payload shape

```json
{
	"schemaVersion": "1.0.0",
	"exportedEntities": {
		"accounts": [/* Account[] */],
		"categories": [/* Category[] */],
		"merchants": [/* Merchant[] */],
		"merchantAliases": [/* MerchantAlias[] */],
		"tags": [/* Tag[] */],
		"transactions": [/* Transaction[] */],
		"transactionSplits": [/* TransactionSplit[] */],
		"transactionTags": [/* TransactionTag[] */],
		"budgets": [/* Budget[] */],
		"budgetItems": [/* BudgetItem[] */],
		"recurringRules": [/* RecurringRule[] */],
		"expectedEvents": [/* ExpectedEvent[] */],
		"investmentHoldings": [/* InvestmentHolding[] */],
		"investmentValuations": [/* InvestmentValuation[] */],
		"liabilities": [/* Liability[] */],
		"netWorthSnapshots": [/* NetWorthSnapshot[] */],
		"userProfile": {/* UserProfile, minus the live in-memory key */}
	}
}
```

Entity shapes are exactly those in [data-model.md](../data-model.md).

## Validation on restore (FR-041)

1. Parse the outer JSON; reject if `container` doesn't match or `containerVersion` is
   unrecognized.
2. Derive the key from the entered PIN and `kdf.salt`; decrypt `ciphertext`. A decryption
   failure (auth tag mismatch) means either a wrong PIN or a corrupted file — report a
   single generic error to avoid leaking which one (avoids weakening the PIN as a guessing
   oracle).
3. Recompute the SHA-256 checksum of the decrypted payload and compare to `checksum`;
   mismatch → reject as corrupted.
4. Compare payload `schemaVersion` to the app's current schema version:
   - **Older, recognized version**: run the matching migration steps (see
     `data/io/migrations/`) to bring the payload up to the current schema, then proceed.
   - **Unrecognized/newer-than-supported version**: reject with a clear "backup from an
     unsupported version" error; do not attempt a best-effort partial restore.
5. Only after steps 1–4 all succeed does the restore write anything to IndexedDB, and it
   does so by replacing the local database in a single transaction — never merging
   partial state with existing data (FR-041's "without altering existing data" on failure).

## Compatibility policy

Every schema change to an entity in data-model.md that is part of the exported payload
requires: (a) a `schemaVersion` bump, and (b) a migration function added under
`data/io/migrations/` from the previous version forward. Migrations are additive/forward
only; the app never needs to export an old schema version.
