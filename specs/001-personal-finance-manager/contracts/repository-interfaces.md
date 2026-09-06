# Contract: Repository Interfaces (Domain ↔ Data layer boundary)

These are the internal contracts that let `domain/` engines remain independent of Dexie or
any storage implementation (Constitution Principle III). Each is a TypeScript interface
implemented by an adapter in `data/dexie/`; unit tests for domain engines mock these
interfaces instead of touching IndexedDB.

## AccountRepository

```ts
interface AccountRepository {
	create(account: NewAccount): Promise<Account>;
	update(id: string, changes: Partial<Account>): Promise<Account>;
	softDelete(id: string): Promise<void>;
	getById(id: string): Promise<Account | null>;
	list(includeArchived?: boolean): Promise<Account[]>;
	hasActiveTransactions(id: string): Promise<boolean>; // guards delete, see data-model.md
}
```

## TransactionRepository

```ts
interface TransactionRepository {
	create(tx: NewTransaction, splits: NewTransactionSplit[]): Promise<Transaction>;
	update(
		id: string,
		changes: Partial<Transaction>,
		splits?: NewTransactionSplit[]
	): Promise<Transaction>;
	softDelete(id: string): Promise<void>;
	restore(id: string): Promise<void>;
	findPossibleDuplicates(accountId: string, amount: number, date: string): Promise<Transaction[]>;
	search(filter: TransactionFilter): Promise<Transaction[]>;
	listUnreviewed(): Promise<Transaction[]>;
}
```

`findPossibleDuplicates` implements the FR-020/FR-038 rule (same account, same amount,
date within ±1 day) and MUST be the single place that rule is implemented, so tests only
need to verify it once.

## BudgetRepository / BudgetItemRepository

```ts
interface BudgetRepository {
	create(budget: NewBudget): Promise<Budget>;
	update(id: string, changes: Partial<Budget>): Promise<Budget>;
	list(): Promise<Budget[]>;
}

interface BudgetItemRepository {
	getOrCreateForPeriod(budgetId: string, periodStart: string): Promise<BudgetItem>;
	recalculateActual(budgetItemId: string): Promise<BudgetItem>;
}
```

## RecurringRepository

```ts
interface RecurringRepository {
	create(rule: NewRecurringRule): Promise<RecurringRule>;
	listActive(): Promise<RecurringRule[]>;
	generateExpectedEvents(rule: RecurringRule, through: string): Promise<ExpectedEvent[]>;
	matchTransaction(tx: Transaction): Promise<ExpectedEvent | null>;
	markMissedPastDue(asOf: string): Promise<ExpectedEvent[]>;
}
```

## WealthRepository

```ts
interface WealthRepository {
	addHolding(holding: NewInvestmentHolding): Promise<InvestmentHolding>;
	addValuation(valuation: NewInvestmentValuation): Promise<InvestmentValuation>;
	addLiability(liability: NewLiability): Promise<Liability>;
	computeNetWorth(asOf: string): Promise<NetWorthSnapshot>;
	netWorthHistory(range: DateRange): Promise<NetWorthSnapshot[]>;
}
```

## CryptoService (data/crypto)

```ts
interface CryptoService {
	deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey>; // PBKDF2 (research.md #6)
	encrypt(key: CryptoKey, plaintext: unknown): Promise<EncryptedBlob>; // AES-GCM
	decrypt(key: CryptoKey, blob: EncryptedBlob): Promise<unknown>;
	hashPin(pin: string, salt: Uint8Array): Promise<string>; // verifier only, FR-004
}
```

`CryptoService` never persists the derived `CryptoKey`; it is held in an in-memory module
singleton for the session's lifetime (Constitution Principle II).

## BackupService (data/io)

```ts
interface BackupService {
	createBackup(): Promise<Blob>; // see backup-format.md
	restoreBackup(file: Blob): Promise<RestoreResult>;
	validate(file: Blob): Promise<ValidationResult>; // integrity + schemaVersion check (FR-041)
}
```

## ImportService (data/io)

```ts
interface ImportService {
	parseCsvPreview(file: Blob): Promise<CsvPreview>; // for column mapping UI
	importCsv(file: Blob, mapping: ColumnMapping): Promise<ImportResult>;
	importXlsx(file: Blob, mapping: ColumnMapping): Promise<ImportResult>;
	importBulkText(file: Blob): Promise<ImportResult>; // SMS-backup-style export
}
```

## QuickAddParser (domain/parser)

```ts
interface QuickAddParser {
	parse(rawText: string): ParsedCandidate; // { amount?, merchantText?, type?, confidence }
}
```

Confidence below the configured threshold routes the UI to manual entry instead of
auto-filling fields (FR-021).
