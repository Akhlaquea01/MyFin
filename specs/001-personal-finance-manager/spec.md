# Feature Specification: Personal Finance Manager (PWA)

**Feature Branch**: `001-personal-finance-manager`

**Created**: 2026-09-06

**Status**: Draft

**Input**: User description: "Personal Finance Manager — PWA (Offline-First): a private,
single-user financial operating system for mobile and desktop that runs entirely in the
browser, with no server/backend, offline-first local storage, encrypted at rest, covering
accounts, transactions, transfers, categories, budgets, recurring finances, investments,
liabilities, analytics, manual/bulk import (replacing SMS auto-ingestion), and encrypted
backup/restore."

## Clarifications

### Session 2026-09-06

- Q: Should the app actively request durable "persistent" browser storage on first run so
  its data can't be silently evicted under storage pressure? → A: Yes — request persistent
  storage on first run; warn the user clearly if it's denied or unsupported.
- Q: How long should the app wait with no user activity before it automatically locks
  itself? (FR-003) → A: 5 minutes of inactivity.
- Q: When checking for "likely duplicate" transactions (FR-020, FR-038), which signals
  should the system match on? → A: Same account + same amount + date within ±1 day.
- Q: Should the app allow itself to be opened in more than one browser tab/window at the
  same time, given that concurrent writes from two tabs could corrupt balances? → A: No —
  detect additional tabs and block/read-only them until the original tab closes.
- Q: When a user restores a backup created by an older version of the app (after the data
  model has since evolved), what should happen? → A: Auto-migrate older recognized versions
  forward on restore; reject only unrecognized/unsupported versions.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Secure Onboarding & App Lock (Priority: P1)

A first-time user opens the app, sets a PIN to protect their financial data, and from then
on must unlock the app with that PIN (or a supported biometric) before seeing any content.
If the app is left idle, it locks itself automatically.

**Why this priority**: Every other feature stores or displays sensitive financial data.
Without a trustworthy lock and encryption foundation, no other story is safe to ship, and
this is independently valuable even with zero financial data yet.

**Independent Test**: Install the app fresh, set a PIN, close and reopen the app (or leave
it idle for 5 minutes to trigger auto-lock), and confirm the app cannot be used without the
correct PIN — and that a wrong PIN is rejected.

**Acceptance Scenarios**:

1. **Given** a fresh install with no PIN set, **When** the user opens the app, **Then** they
   are required to create a PIN before any other screen is accessible.
2. **Given** a PIN has been set, **When** the user reopens the app or it auto-locks after
   inactivity, **Then** they must re-enter the correct PIN to proceed.
3. **Given** the user enters an incorrect PIN, **When** they submit it, **Then** access is
   denied and no financial data is revealed.
4. **Given** the device supports biometric authentication, **When** the user opts in,
   **Then** they may unlock with biometrics, with PIN always available as a fallback.

---

### User Story 2 - Core Ledger: Accounts, Categories & Transactions (Priority: P2)

A user creates one or more accounts (bank, cash, credit card, wallet), records income and
expense transactions against categories, and moves money between their own accounts via
transfers — building a day-to-day record of their finances.

**Why this priority**: This is the minimum viable product: without accounts and
transactions there is no "finance manager" at all. It delivers standalone value — a user
can track their monthly finances manually even before any smarter features exist.

**Independent Test**: Create two accounts, record several income/expense transactions
against categories, perform a transfer between the two accounts, and verify account
balances update correctly and the transfer is not double-counted as income or expense.

**Acceptance Scenarios**:

1. **Given** no accounts exist, **When** the user creates an account with a name, type, and
   opening balance, **Then** the account appears with the correct starting balance.
2. **Given** an existing account, **When** the user records an expense or income
   transaction with an amount, date, and category, **Then** the account balance reflects
   the transaction immediately.
3. **Given** two existing accounts, **When** the user records a transfer between them,
   **Then** the source account decreases and the destination account increases by the same
   amount, and neither side is counted as income or expense in reports.
4. **Given** an existing transaction, **When** the user edits or deletes it, **Then**
   affected account balances are recalculated correctly and the deleted transaction is
   recoverable from a trash/undo area rather than permanently lost immediately.
5. **Given** many transactions exist, **When** the user searches or filters by date,
   category, account, or free text, **Then** only matching transactions are shown.
6. **Given** a transaction with multiple purposes, **When** the user splits it across
   multiple categories, **Then** the parts sum to the original transaction amount.

---

### User Story 3 - Smart Dashboard (Priority: P3)

A user opens the app and immediately sees an at-a-glance summary of their financial
position: balances, net worth, recent activity, unreviewed items, upcoming expected
transactions, and budget status.

**Why this priority**: Once a ledger exists, a dashboard is what turns raw records into
daily usable insight — it's the screen the user will return to most often.

**Independent Test**: With existing ledger data, open the dashboard and verify every
summary figure (total balance, net worth, recent transactions) matches what is derivable
by manually reviewing the underlying accounts and transactions.

**Acceptance Scenarios**:

1. **Given** existing accounts and transactions, **When** the user opens the dashboard,
   **Then** total balance and net worth shown reconcile exactly with the sum of the
   underlying ledger.
2. **Given** transactions awaiting categorization or confirmation, **When** the user views
   the dashboard, **Then** an unreviewed count is shown and links to those items.
3. **Given** upcoming recurring events and active budgets exist, **When** the user views
   the dashboard, **Then** upcoming items and budget status summaries are shown.

---

### User Story 4 - Quick Add & Bulk Text Import (Priority: P4)

A user quickly logs a transaction by pasting a short text (e.g., a bank/payment
notification they copied) into a "Quick Add" field, or imports a batch of such messages
from an exported file, and the app extracts amount, merchant, and type automatically for
the user to review and confirm.

**Why this priority**: This is the fastest day-to-day entry path and directly replaces the
automatic SMS-reading capability that isn't available in a browser; it substantially
reduces manual data-entry effort once the core ledger exists.

**Independent Test**: Paste a sample notification text into Quick Add and verify a
correctly pre-filled, unreviewed transaction is created; separately, import a sample batch
file and verify multiple unreviewed transactions are created with duplicates flagged.

**Acceptance Scenarios**:

1. **Given** a copied notification-style text, **When** the user pastes it into Quick Add,
   **Then** the app proposes amount, merchant, and transaction type for confirmation before
   saving.
2. **Given** a file containing many such messages, **When** the user imports it, **Then**
   each recognizable message becomes an unreviewed transaction pending confirmation.
3. **Given** an incoming message resembles a transaction already recorded, **When** it is
   processed (via paste or bulk import), **Then** it is flagged as a likely duplicate
   instead of being silently double-entered.
4. **Given** a message the parser cannot confidently interpret, **When** it is processed,
   **Then** the user is prompted to fill in the missing details manually rather than the
   message being silently dropped.

---

### User Story 5 - Budgeting (Priority: P5)

A user sets spending budgets for categories over a period (monthly or yearly), optionally
carrying unused amounts forward, and tracks actual spending against those budgets.

**Why this priority**: Budgeting is a core value driver for a finance manager but depends
on the ledger (P2) already producing categorized transactions to compare against.

**Independent Test**: Set a monthly budget for a category, record transactions in that
category, and verify the budget's "actual vs. planned" figure matches the sum of those
transactions for the period.

**Acceptance Scenarios**:

1. **Given** a category with no budget, **When** the user sets a budget amount for a
   period, **Then** the budget appears with 0 spent and the full amount remaining.
2. **Given** an active budget, **When** transactions are recorded in its category during
   the period, **Then** the budget's actual-spent figure updates to match.
3. **Given** a budget configured to roll over, **When** a period ends with unused budget,
   **Then** the remainder carries into the next period's available amount.
4. **Given** spending exceeds a budget's limit, **When** the threshold is crossed, **Then**
   the user is shown an overspending indicator.

---

### User Story 6 - Recurring Finances (Priority: P6)

A user defines recurring rules (e.g., monthly salary, rent, EMI) so the app can predict
expected upcoming transactions and automatically match them against actual transactions
once they occur, flagging anything expected but missing.

**Why this priority**: This adds predictive/planning value on top of the ledger and
budgeting, but is not required for the app to be minimally useful.

**Independent Test**: Create a recurring rule (e.g., monthly rent), verify an expected
upcoming event appears on the dashboard/calendar, record the matching actual transaction,
and confirm the app links the two; then verify a missed occurrence is flagged when no
matching transaction appears by its expected date.

**Acceptance Scenarios**:

1. **Given** a recurring rule is defined, **When** its next occurrence date approaches,
   **Then** an expected event appears ahead of time.
2. **Given** an expected event exists, **When** a matching actual transaction is recorded,
   **Then** the app links them and no longer shows the event as pending.
3. **Given** an expected event's date has passed with no matching transaction, **When** the
   user views recurring finances, **Then** it is flagged as missed.

---

### User Story 7 - Wealth & Debt Tracking (Priority: P7)

A user records investment holdings (with periodic valuations) and liabilities (loans,
credit cards) so the app can calculate and show their overall net worth as assets minus
liabilities, tracked over time.

**Why this priority**: Extends the finance manager beyond day-to-day cash flow into a
complete personal balance sheet; valuable but builds on, and is secondary to, the core
ledger.

**Independent Test**: Add an investment holding with a valuation and a liability with an
outstanding balance, and verify the computed net worth equals total account balances plus
investment value minus liabilities.

**Acceptance Scenarios**:

1. **Given** the user adds an investment holding and records a valuation, **When** they
   view wealth summary, **Then** the holding's current value is included in net worth.
2. **Given** the user adds a liability (loan or credit card) with an outstanding balance,
   **When** they view wealth summary, **Then** it is subtracted from net worth.
3. **Given** holdings, liabilities, and account balances all exist, **When** net worth is
   displayed, **Then** it equals total assets minus total liabilities, and a history of net
   worth over time is available.

---

### User Story 8 - Analytics & Reporting (Priority: P8)

A user views visual breakdowns of their financial activity — spending by category, income
vs. expense trends, cash flow, budget performance, and net worth trend — over selectable
time ranges.

**Why this priority**: Turns accumulated ledger/budget/wealth data into insight; valuable
but depends entirely on data already captured by earlier stories.

**Independent Test**: With a mix of historical transactions across categories and months,
open analytics and verify category totals and trend figures match manual aggregation of
the underlying transactions.

**Acceptance Scenarios**:

1. **Given** transactions spanning multiple categories and months, **When** the user views
   spending analytics, **Then** category and monthly totals shown match the underlying
   transaction data.
2. **Given** budgets exist for the selected period, **When** the user views budget
   performance analytics, **Then** actual-vs-planned figures match the budgeting feature's
   own totals.
3. **Given** net worth history has been recorded, **When** the user views the net worth
   trend, **Then** it reflects the recorded history accurately over the selected range.

---

### User Story 9 - Import/Export & Backup-Restore (Priority: P9)

A user imports transactions in bulk from a spreadsheet/CSV file (mapping columns as
needed), exports their data for external use, and creates an encrypted backup of their
entire financial database that can later be restored — including onto a different device.

**Why this priority**: Protects the user's data (portability and disaster recovery) and
eases migration from other tools, but is not required for daily use of the app.

**Independent Test**: Import a sample CSV of transactions with column mapping and verify
correct records are created with duplicates detected; separately, create a backup, wipe
local data, restore from the backup, and verify all data matches the pre-backup state
exactly.

**Acceptance Scenarios**:

1. **Given** a CSV/XLSX file of transactions, **When** the user maps its columns to the
   app's fields and imports it, **Then** matching transactions are created and likely
   duplicates are flagged rather than duplicated.
2. **Given** existing data, **When** the user exports to CSV/XLSX, **Then** the exported
   file accurately reflects the current ledger.
3. **Given** existing data, **When** the user creates a backup, **Then** the backup is
   encrypted and includes enough information to be validated on restore (e.g., version and
   integrity check).
4. **Given** a valid backup file, **When** the user restores it (on the same or a different
   device), **Then** all accounts, transactions, budgets, recurring rules, investments, and
   liabilities are restored exactly as backed up, with no data loss.
5. **Given** a corrupted or invalid backup file, **When** the user attempts to restore it,
   **Then** the app rejects it with a clear error rather than partially restoring or
   corrupting existing data.

---

### Edge Cases

- What happens when the user forgets their PIN? There is no server-side recovery, and
  backups are encrypted with the same PIN-derived key, so the user must be clearly warned
  during onboarding that losing the PIN means permanent loss of access to both on-device
  data and any backups.
- How does the system handle two transfers or edits happening in rapid succession such that
  balances could be computed inconsistently?
- What happens when the user opens the app in a second browser tab or window while it is
  already open elsewhere? The second instance must be detected and put into a blocked/
  read-only state rather than allowed to write concurrently.
- What happens when an imported file (CSV/XLSX or bulk text) contains malformed or
  unrecognizable rows? They must be reported to the user as skipped, not silently ignored
  or guessed.
- What happens when a recurring rule's expected event overlaps with an unrelated manual
  transaction that looks similar? The system should not auto-link them without user
  confirmation once ambiguity exists.
- What happens when the user's device storage runs low or IndexedDB write fails mid-way
  through an operation? Partial writes must not corrupt existing records.
- What happens when the browser denies or does not support the app's request for durable
  ("persistent") storage? The user must be clearly warned that their data is at higher risk
  of being silently evicted under storage pressure.
- What happens when the user tries to delete an account that still has transactions? The
  system must prevent or clearly warn about orphaning those records.
- How does the app behave the very first time it is opened with no network connection
  available at all (fully offline first launch after install)?

## Requirements _(mandatory)_

### Functional Requirements

**Security & Access**

- **FR-001**: System MUST require the user to set a PIN on first use before any financial
  data can be created or viewed.
- **FR-002**: System MUST require the correct PIN (or an enrolled biometric, where
  supported) to unlock the app on every subsequent launch and after auto-lock.
- **FR-003**: System MUST automatically lock the app after 5 minutes of user inactivity.
- **FR-004**: System MUST NOT store the PIN itself in any recoverable form; only a salted
  verifier may be stored.
- **FR-005**: System MUST encrypt all financial data at rest, including backups, such that
  it cannot be read without the correct PIN.
- **FR-006**: System MUST NOT reveal financial data, PINs, or derived secrets in logs or
  error messages under any circumstance, in any build.

**Accounts, Categories & Transactions**

- **FR-007**: Users MUST be able to create, edit, and deactivate/delete accounts, each with
  a name, type, and opening balance.
- **FR-008**: Users MUST be able to record income and expense transactions with amount,
  date, account, and category.
- **FR-009**: Users MUST be able to split a single transaction across multiple categories,
  with the parts summing to the transaction total.
- **FR-010**: Users MUST be able to tag transactions and assign/rename merchants.
- **FR-011**: Users MUST be able to record a transfer between two of their own accounts
  such that it updates both account balances and is excluded from income/expense totals.
- **FR-012**: Users MUST be able to organize categories into a hierarchy (parent/child)
  with custom names and icons.
- **FR-013**: Users MUST be able to search and filter transactions by date range, account,
  category, tag, and free-text.
- **FR-014**: System MUST support soft-deleting transactions and accounts (recoverable)
  rather than immediate permanent deletion, with a separate explicit action for permanent
  purge.
- **FR-015**: System MUST recalculate all affected balances immediately whenever a
  transaction is created, edited, deleted, or restored.

**Dashboard**

- **FR-016**: System MUST present a summary view showing current balances, net worth,
  recent transactions, count of unreviewed transactions, upcoming expected events, and
  budget status.
- **FR-017**: All figures shown on the dashboard MUST reconcile exactly with the underlying
  ledger data at the time they are displayed.

**Quick Add & Bulk Text Import**

- **FR-018**: Users MUST be able to paste free-text (such as a copied payment notification)
  into a quick-entry field and receive a proposed transaction (amount, merchant, type) for
  review before it is saved.
- **FR-019**: Users MUST be able to import a file containing multiple such text messages in
  bulk, producing one candidate unreviewed transaction per recognizable message.
- **FR-020**: System MUST flag likely duplicate transactions (from quick add, bulk import,
  or file import) for user confirmation instead of creating them automatically, where
  "likely duplicate" means an existing transaction on the same account with the same
  amount and a date within ±1 day.
- **FR-021**: System MUST route any text it cannot confidently parse into a manual-entry
  prompt rather than discarding it silently.
- **FR-022**: System MUST maintain a review queue of unreviewed/unconfirmed transactions
  until the user accepts, edits, or rejects each one.

**Budgeting**

- **FR-023**: Users MUST be able to set a budget amount per category for a monthly or
  yearly period.
- **FR-024**: System MUST track actual spending per category against its budget for the
  active period and show remaining/overspent amounts.
- **FR-025**: Users MUST be able to configure a budget to roll over unused amounts into the
  next period, or reset each period, as a per-budget choice.
- **FR-026**: Users MUST be able to define sinking funds (goal-based savings budgets) that
  accumulate over multiple periods.
- **FR-027**: System MUST indicate when spending has exceeded a budget's threshold.

**Recurring Finances**

- **FR-028**: Users MUST be able to define recurring rules (amount, category, frequency,
  account) for predictable income or expenses.
- **FR-029**: System MUST generate expected upcoming events from recurring rules ahead of
  their due date.
- **FR-030**: System MUST attempt to match actual transactions to expected events and mark
  matched events as fulfilled.
- **FR-031**: System MUST flag expected events as missed when their due date passes without
  a matching transaction.

**Investments & Liabilities**

- **FR-032**: Users MUST be able to record investment holdings and add valuation updates
  over time.
- **FR-033**: Users MUST be able to record liabilities (loans, credit cards) including
  outstanding balance and, where applicable, EMI/payment schedule information.
- **FR-034**: System MUST compute net worth as total assets (account balances + investment
  value) minus total liabilities, and retain a history of net worth over time.

**Analytics**

- **FR-035**: System MUST provide visual breakdowns of spending by category, income vs.
  expense over time, cash flow, budget performance, and net worth trend, each over a
  user-selectable time range.
- **FR-036**: All analytics figures MUST be derived from, and remain consistent with, the
  underlying ledger, budget, and wealth data.

**Data Persistence & Reliability**

- **FR-044**: System MUST request durable ("persistent") browser storage on first run, and
  MUST clearly warn the user within the app if the browser denies or does not support the
  request, since eviction under storage pressure would otherwise risk silent data loss.
- **FR-045**: System MUST detect when it is opened in more than one browser tab/window at
  the same time and MUST put every instance beyond the first into a blocked/read-only state
  (with a message directing the user to the original tab) until only one instance remains,
  to prevent concurrent writes from corrupting balances.

**Import / Export / Backup**

- **FR-037**: Users MUST be able to import transactions from a CSV/XLSX file with the
  ability to map file columns to the app's transaction fields.
- **FR-038**: System MUST detect and flag likely duplicate records during any import,
  rather than creating duplicates automatically, using the same duplicate definition as
  FR-020 (same account, same amount, date within ±1 day).
- **FR-039**: Users MUST be able to export their data (at minimum, transactions) to
  CSV/XLSX.
- **FR-040**: Users MUST be able to create a full, encrypted backup of their entire
  financial database, and later restore from such a backup — including onto a different
  device/installation — reproducing the data exactly.
- **FR-041**: System MUST validate a backup's integrity and version before restoring. A
  backup from an older, recognized schema version MUST be automatically migrated forward to
  the current data model during restore; a backup that is corrupted or of an unrecognized/
  unsupported version MUST be rejected with a clear error, without altering existing data.
- **FR-042**: System MUST support both manual, on-demand backups and an optional
  automatic/scheduled backup.
- **FR-043**: System MUST encrypt backups using the same encryption key already derived from
  the app's PIN (no separate backup passphrase); restoring a backup — including on a
  different device — therefore requires the original PIN.

### Key Entities

- **Account**: A place money is held or owed (bank, cash, wallet, credit card); has a name,
  type, opening balance, and current balance derived from its transactions.
- **Transaction**: A single dated money movement (income, expense, or one side of a
  transfer); linked to an account and one or more categories (via splits), optionally
  tagged and attributed to a merchant; can be soft-deleted.
- **Category**: A user-defined, hierarchical label for classifying transactions and
  budgets.
- **Merchant / Merchant Alias**: The counterparty of a transaction; aliases let differently
  worded references (e.g., from parsed text) resolve to the same merchant.
- **Tag**: A free-form label a user can attach to transactions for cross-cutting
  organization independent of category.
- **Budget / Budget Item**: A planned spending (or saving) amount for a category over a
  period, with optional rollover behavior.
- **Recurring Rule**: A definition of a predictable future transaction (amount, category,
  account, frequency).
- **Expected Event**: A specific predicted occurrence generated from a recurring rule,
  which may be matched to an actual transaction or flagged as missed.
- **Investment Holding / Valuation**: An asset the user owns outside of cash accounts, with
  a history of value updates over time.
- **Liability**: A debt the user owes (loan, credit card), with an outstanding balance and
  optional repayment schedule.
- **Backup Record**: Metadata about a previously created backup (when it was made, its
  version, and its integrity information) for the user's reference.
- **User Profile**: The single local user's settings, including PIN verifier, lock
  preferences, and app-wide preferences.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user cannot view or export any financial data without first entering the
  correct PIN (or enrolled biometric) — verified with zero exceptions across app restarts,
  auto-lock, and device reboot.
- **SC-002**: All figures shown on the dashboard reconcile exactly (100% match) with a
  manual recomputation from the underlying ledger at any point in time.
- **SC-003**: The quick-add text parser correctly extracts amount, merchant, and type from
  at least 95% of a representative sample of real-world payment notification texts.
- **SC-004**: A user can go from opening the app to a fully recorded transaction (manual
  entry) in under 15 seconds.
- **SC-005**: Budget "actual vs. planned" totals match the sum of the underlying
  transactions for the period with 100% accuracy.
- **SC-006**: Displayed net worth always equals total assets minus total liabilities,
  verified to the smallest currency unit.
- **SC-007**: A full backup-then-restore cycle (including onto a different device)
  reproduces 100% of the original data with zero loss or corruption.
- **SC-008**: A user can browse and search a history of at least 10,000 transactions with
  no perceptible lag (results appear in under 1 second).
- **SC-009**: The app remains fully usable (viewing and recording transactions) with no
  network connection at all, including on first launch after installation.
- **SC-010**: At least 90% of test users can complete first-time PIN setup and record their
  first transaction without external help.
- **SC-011**: On every supported browser, the app either successfully secures durable
  storage on first launch or visibly warns the user within that same session that its data
  is not protected from eviction.

## Assumptions

- Single currency, single user per installation (matches the "private, single-user
  financial operating system" framing); multi-currency and multi-profile support are out of
  scope for this baseline.
- Monetary values are tracked in the smallest currency unit (e.g., paise/cents) to avoid
  rounding errors; the default currency is assumed to be Indian Rupees (₹) based on the
  source material, but this is a display/formatting concern, not a functional requirement
  addressed here.
- "Bulk text import" replaces automatic SMS reading (not available to browser-based apps);
  users obtain the source text via manual copy-paste or by exporting messages from a
  separate app on their phone — the export mechanism itself is outside this app's control.
- Biometric unlock is an optional convenience layered on top of the PIN; the PIN remains
  the mandatory fallback on all devices.
- No server-side account recovery exists; since backups are encrypted with the same
  PIN-derived key, losing the PIN means the user's on-device data and any backups cannot be
  recovered by anyone, including the app developer.
- The app is expected to be used on modern mobile and desktop browsers that support local
  installation (Add to Home Screen) and offline operation; legacy browser support is out of
  scope.
- "Automatic/scheduled backup" means the app can prompt or trigger a backup while the app is
  open/foregrounded; it does not assume guaranteed background execution when the app is
  fully closed, since that depends on platform-level browser capabilities outside this
  spec's control.
