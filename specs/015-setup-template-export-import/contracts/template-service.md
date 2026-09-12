# Contract: Template Export/Import Service

This app has no external API; its "contracts" are the internal interfaces between the new
`src/data/io/templateService.ts` module and its callers (`ExportPage.tsx`, and unit/integration
tests), per Constitution Principle III's one-way dependency rule. `templateService.ts` sits in
the same architectural layer as the existing `backupService.ts`/`importService.ts`/
`exportService.ts` — it may call repositories and `TransactionEngine`, never Dexie tables
directly.

## `buildDataTemplate(key): Promise<DataTemplate>`

**Behavior**: Calls every relevant repository's `list()` (non-deleted only) in parallel,
assembles the `DataTemplate` shape per `data-model.md`, and stamps `exportedAt`/
`templateVersion`. MUST NOT include `UserProfile`, `SessionKeyRow`, or `BackupRecord`
(data-model.md). Impure (reads the database) but performs no writes.

**Output**: A plain, JSON-serializable `DataTemplate` object — every monetary field remains an
integer in the smallest currency unit (FR-013); no encoding/formatting is applied at this
layer (that's `exportDataTemplateToJsonBlob`'s job).

**Error cases**: None — an empty database produces a `DataTemplate` with every array empty and
both singleton preference fields `null` (FR-002).

## `exportDataTemplateToJsonBlob(template: DataTemplate): Blob`

**Behavior**: `JSON.stringify(template, null, 2)` wrapped as a `Blob` with
`type: 'application/json'`, mirroring the existing `exportToCsvBlob`/`exportToXlsxBlob`
pattern in `exportService.ts`. Pure, synchronous, no I/O.

## `parseDataTemplate(raw: string): { ok: true; template: DataTemplate } | { ok: false; message: string }`

**Behavior**: Parses `raw` as JSON, verifies `container === 'myfin-data-template'` and that
`templateVersion` is a recognized version, and that `entities` is present. Unknown extra
fields anywhere in the structure are ignored, not rejected (Edge Case: newer-version files).
On any parse or shape failure, returns `{ ok: false, message }` describing the problem in
plain language (FR-009) rather than throwing. Pure.

## `importDataTemplate(key, template: DataTemplate): Promise<TemplateImportResult>`

**Behavior**: Executes the dependency-ordered pass described in `data-model.md`'s
"Relationships preserved" section:

1. For each non-transaction entity type, for each record in the file: look it up in the
   destination via that entity type's match key (data-model.md's table); if found, record
   `oldId -> existingId` in that type's remap map and increment `skipped`; if not found, call
   the corresponding repository's `create` with every foreign key resolved through the
   already-built remap maps, record `oldId -> newId`, and increment `created`. A record whose
   required relationship cannot be resolved (data-model.md, e.g. a `Budget` whose `categoryId`
   resolves to nothing in either the file or the destination) is skipped with reason
   `'unresolved-relationship'` and contributes to neither `created` nor a wrongly-linked
   record.
2. `MerchantCategorySignal` and the two singleton preference rows follow the special handling
   in `data-model.md`'s table (merge; skip-if-exists) rather than step 1's generic rule.
3. For each `Transaction` in the file: resolve its `accountId` through the remap map (skip
   with `'unresolved-relationship'` if it can't be resolved — an orphaned transaction is never
   created); run the extracted `duplicateKey`/`findDuplicateId` check (research.md §3) against
   the destination account's existing transactions; call `TransactionEngine.recordTransaction`
   with `{ deferBalance: true }` (research.md §6) and, when matched, `duplicateOfId` set and
   `reviewStatus: 'unreviewed'`; always increment `created`, additionally increment
   `flaggedDuplicate` when matched. Remap the transaction's own id for its splits/tags/
   attachments below.
4. For each `TransactionSplit`/`TransactionTag` belonging to a transaction created in step 3:
   create it with remapped `categoryId`/`tagId`.
5. For each `Attachment`: if its transaction was newly created in step 3, create it linked to
   that new transaction id; if its transaction instead resolved to a pre-existing transaction
   (data-model.md's duplicate-transaction case), skip it with reason `'already-exists'`
   (Edge Case).
6. Call `TransactionEngine.recalculateAccountBalance` once per distinct account touched by step
   3 (research.md §6) — never inside the per-transaction loop.
7. Yield to the event loop periodically during steps 3-5, reusing the same interval convention
   `importService.ts` already established, so a large import never blocks the UI thread for
   long (FR-014/SC-005).

MUST NOT create anything if `parseDataTemplate` returned `{ ok: false }` for the input (that
case is handled by the caller before `importDataTemplate` is ever invoked) — this function
always assumes a structurally valid `DataTemplate`.

**Output**: `TemplateImportResult` per `data-model.md`.

**Error cases**: A referenced entity type present in the file but entirely absent from
`data-model.md`'s known set (a genuinely newer/unknown top-level key under `entities`) is
ignored wholesale, not partially processed — consistent with "unknown fields are ignored"
(Edge Case), scoped here to whole unknown entity collections as well as unknown fields within
a known one.

## Repository interfaces consumed (read-only for export; read via `list()`/write via `create()` for import)

Every repository already listed in `data-model.md`'s per-entity table
(`AccountRepository`, `CategoryRepository`, `MerchantRepository`, `TagRepository`,
`InvestmentHoldingRepository`/`InvestmentValuationRepository`/`LiabilityRepository`/
`NetWorthSnapshotRepository` (all in `wealthRepository.ts`), `SavingsGoalRepository`/
`GoalContributionRepository`, `BudgetRepository`, `RecurringRepository`/
`ExpectedEventRepository`, `CategorizationRuleRepository`,
`MerchantCategorySignalRepository`, `NotificationPreferenceRepository`,
`DebtPlannerPreferenceRepository`, `AttachmentRepository`) plus `TransactionEngine`/
`TransactionRepository`/`TransactionTagRepository` for the transaction phase. No new
repository is introduced by this feature.
