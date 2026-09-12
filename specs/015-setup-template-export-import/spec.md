# Feature Specification: Complete Data Template Export & Import

**Feature Branch**: `015-setup-template-export-import`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "also a template to export and import that template to have all things like category, account, investment, budget all things better in json format or excel whatever is easy" — later expanded: "Nothing to be out of scope, need all things to be supported with one single export for sample and import." A single, portable, human-readable file that fully captures the user's data — accounts, categories, budgets, transactions, investments, liabilities, net worth history, and everything else the app tracks — exportable and re-importable, distinct from the existing full encrypted backup/restore.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Export everything as one template file (Priority: P1)

A user has built up their full financial picture in the app — accounts, categories, budgets, transactions, investments, liabilities, savings goals, and more — and wants a single portable file capturing all of it, to reuse on a fresh install or keep as a readable, inspectable snapshot, without needing the app's separate encrypted backup mechanism.

**Why this priority**: Nothing else in this feature is possible without a way to produce the file in the first place.

**Independent Test**: Can be fully tested by setting up data across several kinds of records (accounts, categories, budgets, transactions, an investment holding, a liability), exporting a template, and verifying the resulting single file lists every one of them along with how they relate to each other (e.g., which account a transaction belongs to, which category a budget applies to).

**Acceptance Scenarios**:

1. **Given** the user has data across every kind of record the app tracks, **When** they export a data template, **Then** one single downloadable file is produced containing all of it, with the relationships between records preserved (e.g., a transaction's account and category, a budget's category, a subcategory's parent, a receipt attachment's transaction).
2. **Given** the app has no data at all yet, **When** the user exports a template, **Then** a valid, empty template file is produced rather than an error.
3. **Given** the exported file, **When** the user or someone else opens it outside the app, **Then** its contents are readable, not encrypted — unlike the app's existing full backup file.
4. **Given** the exported file, **When** its contents are inspected, **Then** it does not contain the user's PIN, security credentials, or any other device-specific security material — only financial data and configuration.

---

### User Story 2 - Import a template to recreate everything (Priority: P1)

A user with a template file — their own, from a fresh install — wants to load it into the app so every account, category, budget, transaction, and everything else it describes is recreated, instead of manually re-entering any of it.

**Why this priority**: This is the payoff of exporting a template; without import, exporting one has no purpose.

**Independent Test**: Can be fully tested by exporting a template from a fully populated app, starting from a fresh install, importing that file, and verifying the same data (and every relationship between records) now exists.

**Acceptance Scenarios**:

1. **Given** a valid template file and a fresh install with no existing data, **When** the user imports it, **Then** every record described in the file is created, preserving every relationship captured in it (e.g., each transaction ends up linked to the correct account, category, and tags).
2. **Given** an import has finished, **When** the user reviews the result, **Then** they see a summary of how many records of each kind were created.
3. **Given** a template file that is unreadable or structurally invalid, **When** the user attempts to import it, **Then** the import is rejected with a clear explanation and no partial data is created.

---

### User Story 3 - Import into an app that already has data (Priority: P2)

A user imports a template into an app that already has some of its own data — some overlapping with the file, some not — and wants the import to add what's missing without creating duplicates or overwriting or deleting what they already have.

**Why this priority**: Protects existing data during import, a critical safety property, but the core export/import loop (User Stories 1-2) already provides value for the simpler fresh-install case.

**Independent Test**: Can be fully tested by importing a template into an app that already contains some of the same accounts/categories/transactions, and verifying no duplicates are created and none of the existing records change, while genuinely new records from the file are still created.

**Acceptance Scenarios**:

1. **Given** the app already has a category with the same name as one in the template file, **When** the user imports the file, **Then** no duplicate category is created and the existing category is left unchanged.
2. **Given** the app already has a transaction that matches one in the file under the app's existing same-date-and-amount duplicate rule, **When** the user imports the file, **Then** that transaction is still created but is flagged as a likely duplicate and left for the user to review — the same treatment the app already gives a duplicate found during a regular file import — rather than silently dropped.
3. **Given** the app already has some records from the file and some it doesn't, **When** the user imports it, **Then** only the records that don't already exist (or, for transactions, aren't flagged duplicates) are added, and existing records are never overwritten or deleted.
4. **Given** an import completes with some records skipped or flagged, **When** the user reviews the result summary, **Then** it clearly distinguishes what was created from what was skipped or flagged, and why.

---

### Edge Cases

- What happens when a record in the file references a relationship that can't be resolved (e.g., a budget's category isn't present anywhere in the file or the app)? That one record MUST be skipped with a reported reason; the rest of the import MUST proceed normally.
- What happens when a subcategory's parent category is present in the file but was itself skipped as a duplicate, or is missing? The subcategory MUST still be created and linked to the correct (possibly pre-existing) parent whenever it can be resolved; only if no matching parent can be found does it fall back to being created without a parent, and this MUST be reported.
- What happens when a receipt attachment's transaction is skipped as a duplicate rather than newly created? The attachment MUST be skipped along with it and reported, rather than attached to the wrong (existing) transaction.
- What happens when the file was produced by a newer version of the app and contains record kinds or fields this version doesn't recognize? Those unrecognized parts MUST be ignored without failing the rest of the import.
- What happens when the user exports or imports a very large, long-running dataset (thousands of transactions, receipt attachments, years of net worth history)? The operation MUST complete without freezing the app, showing progress if it takes more than a moment, consistent with the app's existing large-dataset handling.
- What happens if the user imports the exact same template file twice in a row? The second import MUST create no duplicate structural records (accounts, categories, budgets, etc.) and MUST apply the same duplicate-flagging behavior to transactions as any other repeated/overlapping import would.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST allow the user to export all of their data — accounts, categories, merchants and tags, transactions (with their category splits and tags), budgets, recurring rules, investment holdings and valuations, liabilities, net worth snapshot history, savings goals and contributions, categorization rules, notification preferences, and receipt attachments — into a single downloadable template file that preserves every relationship between them.
- **FR-002**: Export MUST succeed and produce a valid, empty template when the app has no data yet, rather than failing.
- **FR-003**: The exported file MUST remain human-readable and MUST NOT be encrypted, distinguishing it from the app's existing full encrypted backup, which is unaffected by this feature.
- **FR-004**: The exported file MUST NOT include the user's PIN verifier, cryptographic salts, biometric enrollment data, or any other device-specific security credential — a template describes financial data and configuration, never authentication material.
- **FR-005**: The system MUST allow the user to import a previously exported (or otherwise compatibly structured) template file.
- **FR-006**: Import MUST create every record described in the file that does not already exist in the app, preserving every relationship captured in the file (e.g., a transaction's account/category/tags, a budget's category, an attachment's transaction).
- **FR-007**: For every record type except transactions, import MUST detect records that already exist (matched by their defining attributes, e.g., name, and parent for hierarchical entities) and MUST skip creating duplicates for them without altering the existing record.
- **FR-008**: For transactions specifically, import MUST apply the app's existing duplicate-transaction rule (matching account, date, and amount): a matching transaction is still created but flagged as a likely duplicate for the user to review, exactly as an ordinary file import already behaves — never silently dropped and never silently merged into the existing one.
- **FR-009**: Import MUST reject a file that cannot be read or does not match the expected structure, with a clear explanation, and MUST NOT create any records from a rejected file.
- **FR-010**: Import MUST handle a record whose described relationship cannot be resolved by skipping only that record (and anything that depends solely on it) and reporting why, without failing the rest of the import.
- **FR-011**: After an import finishes, the system MUST present a summary distinguishing how many records of each kind were created, skipped, or flagged as duplicates, with reasons.
- **FR-012**: The system MUST present this template export/import feature as distinct from the existing full backup/restore feature, making clear that, unlike the full backup's all-or-nothing replace, importing a template only adds what's missing (or flags likely duplicate transactions) and never overwrites or deletes existing data.
- **FR-013**: Monetary values in a template MUST use the same integer, smallest-currency-unit convention used everywhere else in the app.
- **FR-014**: Export and import of a large complete dataset (e.g., thousands of transactions and their attachments) MUST complete without freezing the app, showing progress if it takes more than a moment.

### Key Entities

- **Data Template**: The portable, human-readable file produced by export and consumed by import. Contains every kind of record the app tracks on the user's behalf — accounts, categories, merchants, tags, transactions and their splits/tags, budgets, recurring rules, investment holdings and valuations, liabilities, net worth snapshots, savings goals and contributions, categorization rules, notification preferences, and receipt attachments — together with the relationships between them. Does not contain the user's security credentials (PIN verifier, salts, biometric enrollment), which remain exclusive to the existing full encrypted backup and to the device itself.
- **Import Result Summary**: The outcome of a single import operation — counts of records of each kind created, skipped (already existed, or an unresolved relationship), or flagged (likely duplicate transactions), with reasons for each.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can export the entirety of their data as one template file in under 30 seconds, even with a large dataset.
- **SC-002**: A user can recreate their complete financial data and setup on a fresh install by importing one file, without manually re-entering any of it.
- **SC-003**: Importing a template into an app where 100% of its structural records (accounts, categories, budgets, etc.) already exist creates zero duplicates of them and alters none of them.
- **SC-004**: 100% of structurally invalid template files are rejected without creating any records or altering existing data.
- **SC-005**: Importing a template containing thousands of transactions and attachments completes without freezing the app's interface.

## Assumptions

- The template is implemented as a single structured (JSON) file rather than a spreadsheet, since the data is relational (subcategories reference parents, transactions reference accounts/categories/tags, attachments reference transactions) and a spreadsheet would require many linked sheets to represent the same relationships without ambiguity.
- Every kind of record the app stores on the user's behalf is in scope for this template, with the sole exception of the user's own device-level security credentials (PIN verifier, cryptographic salts, biometric enrollment), which cannot be safely represented in a human-readable, unencrypted file and remain the exclusive concern of the existing full encrypted backup. This supersedes an earlier, narrower draft of this spec that limited scope to categories/accounts/budgets/investments only.
- An earlier idea of letting the user strip real monetary values out of the export for safer sharing with a third party has been dropped in favor of always producing one complete, single export; a user who wants to redact something before sharing can still hand-edit the human-readable file themselves. Safely sharing a scrubbed subset with someone else is a separate concern this feature does not address.
- Transaction duplicate handling during import reuses the exact same rule and behavior (flag-and-create-unreviewed, not skip) already established by the app's existing file import feature, rather than the skip-outright rule used for structural records like categories and accounts — keeping one consistent duplicate-transaction policy across every import path in the app.
- An imported account is always created as a new account seeded with the template's opening balance; importing a template never modifies an existing account's live balance or current transactions.
- Matching for duplicate detection on non-transaction records is case-insensitive and follows the same identity conventions (name, and parent for hierarchical entities like subcategories) already used elsewhere in the app for merchant and tag matching.
- The file is downloaded to and re-uploaded from the user's own device; the app does not provide any direct device-to-device transfer mechanism as part of this feature, consistent with the app's local-first, zero-server design.
