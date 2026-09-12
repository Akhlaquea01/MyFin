# Feature Specification: Multi-Account Transaction Import

**Feature Branch**: `009-multi-account-import`

**Created**: 2026-09-12

**Status**: Draft

**Input**: User description: "Extend the existing CSV/XLSX transaction import so a single
file can contain transactions for multiple accounts, routing each row to the correct
account automatically instead of requiring one file per account."

## Clarifications

### Session 2026-09-12

- Q: When an import file's account value (e.g., "Checking") matches more than one existing
  account with that same name, how should the system resolve it? → A: Block the entire
  import up front and require the user to rename one of the duplicate accounts before
  proceeding.
- Q: Should an archived (deactivated) account be a valid match when the system resolves an
  account name from the import file? → A: Yes — archived accounts are valid matches just
  like active accounts.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Import One File Covering Several Accounts (Priority: P1)

A user has a consolidated export (e.g., from their bank's "all accounts" download) or has
combined statements from checking, savings, and a credit card into one file. Instead of
splitting the file by account and importing it three separate times, they import it once,
mark which column identifies the account for each row, and the system routes each
transaction to the correct account automatically.

**Why this priority**: This is the entire value of the feature. Without it, users must
manually split files and run multiple imports, which is the exact friction this feature
removes.

**Independent Test**: Import a file containing rows for three different existing accounts,
each row carrying an account name in one column, and verify all transactions land in the
correct account with no manual splitting.

**Acceptance Scenarios**:

1. **Given** a file with a column identifying the account per row, **When** the user maps
   that column during import configuration, **Then** each transaction is created under the
   account named in its row.
2. **Given** a file with no account-identifying column, **When** the user imports it,
   **Then** the system behaves exactly as it does today — every row goes to the single
   account the user selects for the whole import.

---

### User Story 2 - Catch Misrouted or Unmatched Accounts Before Importing (Priority: P2)

Before committing an import, the user wants to see which account each row will go to, and
be warned about any row whose account reference doesn't match one of their existing
accounts (e.g., a typo, an account they haven't created yet, or a blank cell) — so nothing
is silently imported to the wrong place or lost.

**Why this priority**: Multi-account routing only becomes trustworthy if mistakes are
visible before data is committed. This is what makes User Story 1 safe to rely on.

**Independent Test**: Import a file where one row's account value doesn't match any
existing account, and verify the preview clearly flags that row and explains why, before
any transactions are created.

**Acceptance Scenarios**:

1. **Given** a mapped account column, **When** the user views the import preview, **Then**
   each row shows the account it will be imported to.
2. **Given** a row whose account value doesn't match any existing account (typo, blank, or
   unrecognized), **When** the user views the preview, **Then** that row is visibly flagged
   with the reason and will not be imported.
3. **Given** flagged rows exist, **When** the user proceeds with the import anyway,
   **Then** only the resolvable rows are imported and the flagged rows are excluded and
   reported.
4. **Given** the account value on a row matches the name of more than one existing account,
   **When** the user attempts the import, **Then** the entire import is blocked (no
   transactions from any row are created) and the user is told which account name is
   duplicated so they can rename one of the accounts and retry.

---

### User Story 3 - See Results Broken Down by Account (Priority: P3)

After a multi-account import completes, the user wants a summary showing how many
transactions went to each account, so they can quickly confirm the import matched their
expectations without having to open each account individually.

**Why this priority**: A nice confirmation/confidence step on top of the core import, but
the feature is still useful without it — users could otherwise check each account manually.

**Independent Test**: Complete a multi-account import and verify the result summary lists
a transaction count per account that matches the source file.

**Acceptance Scenarios**:

1. **Given** a completed multi-account import, **When** the result is displayed, **Then**
   it shows the number of transactions created for each affected account.
2. **Given** a completed single-account import (no account column used), **When** the
   result is displayed, **Then** it shows the existing single-account summary unchanged.

---

### Edge Cases

- What happens when the account column is blank for a row? → Row is treated as
  unresolved/skipped and reported, not silently assigned to a default account.
- What happens when an account value has different casing or extra whitespace than the
  account's actual name (e.g., " checking " vs "Checking")? → Still matches; comparison is
  case-insensitive and ignores surrounding whitespace.
- What happens when an account value matches more than one existing account (the app does
  not currently prevent two accounts from sharing a name)? → The entire import is blocked
  before any transactions are created; the user is told which account name is duplicated
  and must rename one of the colliding accounts before retrying.
- What happens when a file mixes rows with and without an account value, while an account
  column is mapped? → Rows with a resolvable value are routed accordingly; rows with a
  blank/unresolved value are skipped and reported, not assigned to any implicit default.
- What happens when an account value matches only an archived (deactivated) account? →
  It still resolves normally; archived accounts are valid import destinations the same as
  active ones.
- What happens to duplicate detection when rows for the same date/amount exist across
  different accounts? → Duplicate detection still applies, scoped to each row's resolved
  account, exactly as it does for single-account imports.
- What happens if every row's account value fails to resolve? → No transactions are
  created; the user sees zero created and every row reported as unresolved, rather than a
  confusing partial or failed state.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: When configuring an import, users MUST be able to designate one column in
  the file as the account indicator for each row, in addition to the existing date, amount,
  and description column mappings.
- **FR-002**: The account indicator column MUST be optional; when it is not designated, the
  import MUST behave exactly as it does today, importing every row into the single account
  selected for the whole import (backward compatible).
- **FR-003**: When an account indicator column is designated, the system MUST resolve each
  row's account by matching its value against the user's existing accounts — including
  archived accounts, which are eligible matches like any other — ignoring case and
  surrounding whitespace.
- **FR-004**: Any row whose account value is blank or does not match any existing account
  MUST be excluded from the import and reported to the user with the row and the reason,
  using the same reporting mechanism as other malformed rows.
- **FR-005**: Before any transactions are created, the import preview MUST show, for every
  row, which account it will be imported to, and MUST visibly distinguish rows that will be
  excluded due to an unresolved account.
- **FR-006**: If an account value used anywhere in the file matches the name of more than
  one existing account, the system MUST block the entire import — no transactions from any
  row are created — and MUST tell the user which account name is duplicated so they can
  rename one of the colliding accounts and retry. This is a whole-import block, distinct
  from the per-row exclusion in FR-004.
- **FR-007**: The system MUST apply the same duplicate-detection, categorization, and
  review workflow used for single-account imports to multi-account imports, scoped to each
  row's resolved account.
- **FR-008**: After an import completes, the system MUST report the number of transactions
  created, broken down per account when more than one account was involved.
- **FR-009**: The system MUST NOT create an account automatically on the basis of an import
  file's account column; rows referencing an account the user has not already created are
  treated as unresolved (see FR-004).

### Key Entities

- **Account**: An existing user-owned account (e.g., checking, savings, credit card) that
  transactions can be imported into, including archived accounts. Identified to the import
  process by its name.
- **Import File Row**: One line of the uploaded file, carrying the data needed to create a
  transaction (date, amount, description) plus, optionally, an account indicator value used
  to determine its destination account.
- **Import Result**: The outcome of an import operation, including how many transactions
  were created, which rows were excluded and why, which were flagged as possible
  duplicates, and — for multi-account imports — a count of transactions created per
  account.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can import a single file containing transactions for three or more
  accounts in one operation, with every resolvable row routed to the correct account,
  eliminating the need to split the file or repeat the import per account.
- **SC-002**: 100% of rows with an unresolvable account reference are caught and reported
  before import, with zero transactions silently created against the wrong account.
- **SC-003**: The post-import summary's per-account transaction counts match the source
  file exactly, verifiable without inspecting each account individually.
- **SC-004**: Files that don't use an account column continue to import with identical
  results to today's single-account behavior, with no regression.
- **SC-005**: When an account name used in the file is shared by more than one existing
  account, the user is stopped before any data is imported and is told exactly which name
  is duplicated, with zero transactions created from that attempt.

## Assumptions

- Users import into accounts they have already created; this feature does not create
  accounts on their behalf.
- Account matching is by name, case-insensitive and whitespace-trimmed. The existing
  account management feature does not currently enforce unique account names, so this
  feature must detect name collisions itself (see FR-006) rather than assume they can't
  occur.
- Rows with a blank or unrecognized account value are skipped and reported without
  blocking the rest of the import (FR-004); a name that resolves to more than one existing
  account instead blocks the entire import (FR-006), since silently guessing which account
  was meant is not acceptable.
- Detecting or creating transfer pairs between accounts from within an import is out of
  scope; imported rows are treated as ordinary income/expense transactions.
