# MyFin — Feature Documentation

This document provides a comprehensive reference of the features built into the MyFin application, detailing user workflows, business logic, domain engines, data models, and UI surfaces.

---

## Table of Contents

1. [Feature 001: Core Personal Finance Manager & Encrypted Ledger](#feature-001-core-personal-finance-manager--encrypted-ledger)
2. [Feature 002: Debt Payoff Planner](#feature-002-debt-payoff-planner)
3. [Feature 003: Savings Goals Tracker](#feature-003-savings-goals-tracker)
4. [Feature 004: Recurring Budget Notifications](#feature-004-recurring-budget-notifications)
5. [Feature 005: Encrypted Receipt Attachments](#feature-005-encrypted-receipt-attachments)
6. [Feature 006: Auto-Categorization & Merchant Learning](#feature-006-auto-categorization--merchant-learning)
7. [Feature 007: Financial Health Insights & Score](#feature-007-financial-health-insights--score)
8. [Feature 008: PWA Web Share Target](#feature-008-pwa-web-share-target)
9. [Feature 009: Multi-Account File Import](#feature-009-multi-account-file-import)
10. [Feature 010: Lending & Borrowing (Person Loans)](#feature-010-lending--borrowing-person-loans)
11. [Feature 011: Year In Review Report & PDF Export](#feature-011-year-in-review-report--pdf-export)
12. [Feature 012: Tag Taxonomy & Search Engine](#feature-012-tag-taxonomy--search-engine)
13. [Feature 013: Saved Transaction Filter Presets](#feature-013-saved-transaction-filter-presets)
14. [Feature 014: Interactive Quick Tour & Onboarding](#feature-014-interactive-quick-tour--onboarding)
15. [Feature 015: Starter Setup Template Export & Import](#feature-015-starter-setup-template-export--import)
16. [Feature 016: Core Workflow Improvements](#feature-016-core-workflow-improvements)
17. [Feature 017: Financial Visibility & Control Enhancements](#feature-017-financial-visibility--control-enhancements)
18. [Feature 018: Financial Planning & Productivity Enhancements](#feature-018-financial-planning--productivity-enhancements)
19. [Feature 020: Android Fingerprint Unlock, Editable Review & Auto-capture](#feature-020-android-fingerprint-unlock-editable-review--auto-capture)
20. [Feature 021: QA Hardening — Recovery, Durability & Everyday Flow](#feature-021-qa-hardening--recovery-durability--everyday-flow)
21. [Feature 022: Clearer Review, Search-as-you-type Categories & a Charted Dashboard](#feature-022-clearer-review-search-as-you-type-categories--a-charted-dashboard)
22. [Feature 023: Audit Hardening — Imports, Integrity & Start-up](#feature-023-audit-hardening--imports-integrity--start-up)
23. [Feature 024: Purpose Tags, Card Capture, One Recurring Page & a Categories Revamp](#feature-024-purpose-tags-card-capture-one-recurring-page--a-categories-revamp)
24. [Feature 025: A Shorter Sidebar — Data, Automation & Settings](#feature-025-a-shorter-sidebar--data-automation--settings)
25. [Feature 026: Versioned Releases & In-app Updates (Android)](#feature-026-versioned-releases--in-app-updates-android)

---

## Feature 001: Core Personal Finance Manager & Encrypted Ledger

### Overview

The foundational layer of MyFin providing zero-knowledge, local-first personal financial management. All sensitive data (transactions, accounts, budgets, payees) is stored encrypted in browser IndexedDB.

### Key Capabilities

- **Accounts Management**: Four account types: `bank`, `cash`, `wallet` and `credit_card`. Investments and loans are tracked separately (Investments, Liabilities and People).
- **Encrypted Double-Sided Ledger**: Immutable transaction history supporting income, expense, and account transfers.
- **Split Transactions**: Allocate a single transaction across multiple categories.
- **Hierarchical Categories**: Parent/child category tree, understood everywhere categories appear. A budget on a parent covers every subcategory below it (the card says "Includes N subcategories"; a child budget tracks only the child), and the Budget vs. Actual report neither lists a covered subcategory as "unbudgeted" nor counts it twice. Pickers, transaction lists, charts, notifications and exports label a subcategory with its full path ("Food › Groceries"), so two "Other" subcategories under different parents can be told apart, and children sit under their parent in pickers. Analytics can optionally group subcategories under their top-level parent. A parent with subcategories can't be deleted until they are gone, and a subcategory orphaned by an older deletion is shown at the top level instead of vanishing. The Categories page itself was rebuilt in Feature 024 (monthly totals, budgets, colours, icons, merge).
- **Quick Add**: Paste a bank/SMS message to get a proposed, reviewable transaction. Reads amounts written `Rs.500`, `INR 500`, `₹500`, `500 INR`, or with no currency at all when a verb introduces them (`debited by 500.00`, `Amount: 750`); never takes an account number, reference or digits glued to an account tag for the amount, and takes the transaction amount rather than a later balance. The account is picked from the digits the message names ("A/c XX1234", "XXXX-1234", "card ending 5678") when they match an account's saved digits; a message that looks like a duplicate of an existing entry (same account, same amount, within a day — including entries still in Review) is shown to you before saving; adding it anyway marks it as a possible duplicate in Review.
- **Account Transfers & Card Bill Payments**: One flow moves money between two of the user's own accounts as a single linked pair of transactions; the same screen, switched to "Card bill payment", pays a credit card (showing what is owed, with a one-tap "Pay full outstanding"). The New Transaction type picker, the card's own "Pay bill" button, and a recognised Quick Add message all lead there. Deleting, restoring or editing either leg acts on both, atomically.
- **Record as Transfer**: An entry that was imported or entered as an ordinary expense/income (typically a card payment) can be converted to a transfer from the Review Queue or the Edit dialog — linking to the matching entry already on the other account (found by amount and date) or creating the missing leg — so it stops counting as spending/income and both balances agree.
- **Edit Transactions**: Every transaction can be edited in place (account, type, amount, date, category, merchant, tags, notes). A transfer is edited as one movement; the ledger entry behind a person loan is read-only and managed from People.
- **Liabilities & Net Worth**: Manual liability tracking (loans, credit card debt) alongside a computed net worth figure spanning accounts, liabilities, investments, and person loans, with historical snapshots. A liability's balance, EMI, due day, rate and minimum payment can be edited, and **Record payment** pays it from a bank/cash/wallet account in one step — the money leaves the account and the amount owed drops by the same amount (net worth is unchanged). The ledger entry is linked to the payment, so it can only be reversed with **Undo** on the Liabilities page, not edited or deleted on its own. A card already tracked as an account is paid with "Pay bill" instead.
- **PIN & Biometric Authentication**: Onboarding PIN entry with PBKDF2 key derivation and biometric unlock — WebAuthn in the browser, Android's fingerprint prompt in the APK (see Feature 020). The PIN can be changed from **Security** (the whole database is re-encrypted under the new PIN in one transaction) and, if forgotten, the lock screen's **Forgot your PIN?** is the one way out: it erases the device after a typed confirmation, so a backup can be restored under its own PIN (see Feature 021).
- **CSV / Excel Export**: One row per transaction with `date, account, categories, amount, notes` (the original columns, unchanged and first) followed by `type` (income / expense / transfer), `merchant`, `tags`, `status` (confirmed / unreviewed) and `counterpart` (the account on the other side of a transfer). A transfer is therefore identifiable as one — and has no category — instead of looking like an uncategorized expense plus an uncategorized income. Subcategories are exported by full path; text columns are protected against spreadsheet-formula injection.
- **Encrypted Backup & Restore**: AES-GCM encrypted single-file backup export (key derived from the PIN with 600,000 PBKDF2 rounds) with SHA-256 checksum verification on restore. **Check my data** on the same page re-adds every account from its entries and reports anything that disagrees with itself, with a one-click rebuild of balances.
- **Permanent Deletes**: Deleting a transaction (both legs of a transfer), account, category, savings goal, categorization rule, person, loan, repayment, holding, liability or budget removes it for good, after a confirmation that says it cannot be undone. There is no Trash and no Undo; what hangs off a record goes with it (a transaction's receipts, splits and tags; a goal's contributions; a holding's recorded values; a budget's period items). Deleting a category files its transactions under Uncategorized. Upgrading from a version that had a Trash removes whatever was in it, and restoring an older backup skips its trashed records.

### Domain Engine & Architecture

- **Engine**: [`src/domain/transactions/transactionEngine.ts`](../../src/domain/transactions/transactionEngine.ts), [`src/domain/wealth/wealthEngine.ts`](../../src/domain/wealth/wealthEngine.ts) (net worth/liabilities)
- **Repositories**: [`accountRepository.ts`](../../src/data/dexie/accountRepository.ts), [`transactionRepository.ts`](../../src/data/dexie/transactionRepository.ts), [`categoryRepository.ts`](../../src/data/dexie/categoryRepository.ts), [`wealthRepository.ts`](../../src/data/dexie/wealthRepository.ts)
- **Primary Pages**: [`DashboardPage.tsx`](../../src/pages/DashboardPage.tsx), [`AccountsPage.tsx`](../../src/pages/AccountsPage.tsx), [`TransactionsPage.tsx`](../../src/pages/TransactionsPage.tsx), [`NewTransactionPage.tsx`](../../src/pages/NewTransactionPage.tsx), [`CategoriesPage.tsx`](../../src/pages/CategoriesPage.tsx), [`TransferPage.tsx`](../../src/pages/TransferPage.tsx), [`LiabilitiesPage.tsx`](../../src/pages/LiabilitiesPage.tsx), [`NetWorthPage.tsx`](../../src/pages/NetWorthPage.tsx)

---

## Feature 002: Debt Payoff Planner

### Overview

An interactive financial planning engine allowing users to simulate, compare, and execute debt reduction strategies across credit cards and loans.

### Key Capabilities

- **Payoff Strategies**:
  - **Snowball**: Prioritizes smallest balance first for rapid psychological momentum.
  - **Avalanche**: Prioritizes highest interest rate (APR) first for mathematical interest minimization.
  - **Custom / Manual**: User-defined debt payoff prioritization order.
- **Amortization & Forecasts**: Computes debt-free milestone dates, total interest paid under each strategy, and monthly payment schedules.
- **Extra Payment Modeling**: Dynamically calculates interest and time saved when applying extra monthly lump sums.
- **Preference Persistence**: User's chosen payoff strategy and extra payment amounts persist in encrypted storage.

### Domain Engine & Architecture

- **Engine**: [`src/domain/debtPlanner/generatePlan.ts`](../../src/domain/debtPlanner/generatePlan.ts)
- **Repository**: [`debtPlannerPreferenceRepository.ts`](../../src/data/dexie/debtPlannerPreferenceRepository.ts)
- **Primary Page**: [`DebtPayoffPlannerPage.tsx`](../../src/pages/DebtPayoffPlannerPage.tsx)

---

## Feature 003: Savings Goals Tracker

### Overview

Visual goal tracking that connects target savings amounts with dedicated or pooled financial accounts, displaying progress, target timelines, and forecast indicators.

### Key Capabilities

- **Target Tracking**: Set goal target amount, currency, target completion date, and priority.
- **Funding Models**:
  - Direct account balance linking.
  - Manual contribution logging with historical milestone tracking.
- **Progress Projection**: Real-time pace calculation (on track, behind schedule, ahead of schedule) based on the average monthly savings rate (what was saved after the first deposit, over the months since it).
- **Delete**: A goal can be deleted, along with its logged contributions.

### Domain Engine & Architecture

- **Engine**: [`src/domain/savingsGoals/goalProgress.ts`](../../src/domain/savingsGoals/goalProgress.ts)
- **Repository**: [`savingsGoalRepository.ts`](../../src/data/dexie/savingsGoalRepository.ts)
- **Primary Page**: [`SavingsGoalsPage.tsx`](../../src/pages/SavingsGoalsPage.tsx)

---

## Feature 004: Recurring Budget Notifications

### Overview

Predictive bill calendar, recurring payment automation, and proactive budget threshold notification checks.

### Key Capabilities

- **Recurring Cadences**: Weekly (a weekday, 0 = Sunday), monthly (a day of the month) and yearly (a month and a day of that month, so 1 March is 1 March every year; 29 February falls on the 28th in other years) rules. The day field is described in those terms everywhere it is asked, including "Mark as recurring" in Review, which starts from the transaction's own date.
- **Expected Events Generation**: Projects future transaction occurrences with status tracking (`pending`, `matched`, `missed`).
- **Payment Matching**: A recorded transaction on the rule's account, for the same amount and direction within ±3 days of an expected event, marks it `matched`. An _uncategorized_ entry matches regardless of the rule's category (bills usually arrive from a statement or SMS before they are categorized); an entry with a different real category does not. A `missed` event is matched if the bill is recorded late. Matches are re-evaluated when an entry is confirmed or edited, and released when it is deleted or turned into a transfer. Transfers never match.
- **Budget Threshold Alerts**: Configurable alerts when category spend exceeds 80%, 90%, or 100% of budgeted envelope.
- **In-App Alerts**: Due bills, budget thresholds and overdue loans are checked each time MyFin is unlocked. Each new one is shown as a system notification (a browser notification, or a real Android one in the APK) **and** kept in the in-app **Alerts** list — whatever the notification permission is, so a reminder the system could not show is still there. Alerts have an unread badge in the menu, open the matching screen (Upcoming, Budgets, People) when tapped, and can be dismissed, marked read or cleared (the last asks first). One entry per occurrence; the newest 100 are kept. Tapping an Android notification opens the same screen. Because the check runs on unlock, a reminder cannot appear while the app is closed — the Notifications page says so, and shows whether the device currently allows notifications at all.
- **Local notifications only**: No server and no push service; nothing about the user's money is handed to the OS scheduler. The one scheduled notification is the fixed-text weekly backup reminder (Feature 021).
- **Notification Settings**: User-configurable master enable/disable, reminder lead days, and budget threshold percentage.

### Domain Engine & Architecture

- **Engines**: [`src/domain/recurring/recurringEngine.ts`](../../src/domain/recurring/recurringEngine.ts), [`src/domain/notifications/notificationEngine.ts`](../../src/domain/notifications/notificationEngine.ts)
- **Repositories**: [`recurringRepository.ts`](../../src/data/dexie/recurringRepository.ts), [`notificationRepository.ts`](../../src/data/dexie/notificationRepository.ts)
- **Primary Pages**: [`RecurringPage.tsx`](../../src/pages/RecurringPage.tsx), [`RecurringUpcomingPage.tsx`](../../src/pages/RecurringUpcomingPage.tsx), [`BudgetsPage.tsx`](../../src/pages/BudgetsPage.tsx), [`NotificationSettingsPage.tsx`](../../src/pages/NotificationSettingsPage.tsx)

---

## Feature 005: Encrypted Receipt Attachments

### Overview

Client-side encrypted image and document attachment system allowing users to store receipts, invoices, and payment confirmations alongside transactions.

### Key Capabilities

- **Client-Side Compression**: High-quality canvas-based downscaling (max 1600px dimension, JPEG/WebP compression) before encryption to conserve storage.
- **Multi-Attachment**: Up to 5 attachments per transaction.
- **Zero-Knowledge Encryption**: Image binary data is AES-256-GCM encrypted before being stored in IndexedDB.
- **Secure Image Viewer**: Lightbox modal with zoom, pan, rotation, and export capabilities.
- **Automatic Cascading Deletion**: Deleting a transaction deletes its attachments with it.

### Domain Engine & Architecture

- **Helpers**: [`src/lib/imageAttachment.ts`](../../src/lib/imageAttachment.ts)
- **Repository**: [`attachmentRepository.ts`](../../src/data/dexie/attachmentRepository.ts)
- **Component**: Embedded in [`TransactionsPage.tsx`](../../src/pages/TransactionsPage.tsx) and transaction edit sheets.

---

## Feature 006: Auto-Categorization & Merchant Learning

### Overview

Automated transaction categorization engine combining explicit user-defined matching rules with continuous merchant streak learning.

### Key Capabilities

- **Merchant & Alias Rules**: A rule maps a merchant (or one specific alias of it) to a category and tags. At most one live rule exists per merchant + scope.
- **Keyword Rules ("description contains")**: A rule can instead match _text_: any transaction whose description or merchant name has a word starting with the keyword — case- and punctuation-insensitive, so `swiggy` files `UPI-SWIGGY-88123`, `SWIGGY INSTAMART` and `Swiggy One` alike, which per-merchant rules cannot (each distinct description is its own merchant). Needs at least 3 letters/digits; the same keyword can't be added twice however it is written. The rule dialog previews which uncategorized transactions the keyword would catch before it is saved. Works on manual entry, Quick Add, file and bulk imports, including rows with no merchant at all. There is no regex matching.
- **Precedence**: exact-alias rule → merchant rule → keyword rule (the longest matching keyword wins; an exact tie goes to the older rule) → learned suggestion. A category you chose yourself is never overridden.
- **Merchant Normalization**: Strips reference numbers, dates and rail codes (UPI/NEFT/IMPS…) from imported descriptions so repeat sightings converge on one merchant. Manual entry now reuses an existing merchant by name instead of creating a new one every time.
- **Streak Learning Engine**: When a user confirms the same category for a merchant 3 times in a row — in the Review Queue, or by choosing the category by hand on a new entry — the engine surfaces a suggestion. A merchant that already has a rule — or whose name a keyword rule already matches — is never offered a suggestion.
- **Retroactive Apply**: Creating or promoting a rule (merchant or keyword) offers to file the existing, still-uncategorized transactions it matches; the Review Queue has "Apply rules to queue"; and a rule can be applied later from its row. An entry that already has a category is never overridden.
- **Visible Provenance**: The Review Queue marks a pre-filled category as "Auto: rule" or "Suggested", and New Transaction previews what the typed merchant will be filed under.

### Domain Engine & Architecture

- **Engine**: [`src/domain/categorization/categorizationEngine.ts`](../../src/domain/categorization/categorizationEngine.ts), [`keywordMatching.ts`](../../src/domain/categorization/keywordMatching.ts), [`resolveCategorization.ts`](../../src/domain/categorization/resolveCategorization.ts), [`src/domain/parser/merchantResolver.ts`](../../src/domain/parser/merchantResolver.ts)
- **Repositories**: [`categorizationRuleRepository.ts`](../../src/data/dexie/categorizationRuleRepository.ts), [`merchantCategorySignalRepository.ts`](../../src/data/dexie/merchantCategorySignalRepository.ts)
- **Primary Page**: [`CategorizationRulesPage.tsx`](../../src/pages/CategorizationRulesPage.tsx)

---

## Feature 007: Financial Health Insights & Score

### Overview

Holistic financial wellness assessment calculating an aggregate health score (0–100) and actionable pillar diagnostics.

### Key Capabilities

- **Health Pillars**:
  1. **Emergency Fund Runway**: Months of fixed living expenses covered by liquid cash.
  2. **Savings Rate**: Percentage of net monthly income retained.
  3. **Debt-to-Income (DTI) Ratio**: Monthly debt obligations vs gross income.
  4. **Budget Adherence**: Frequency and scale of envelope overspending.
- **Actionable Guidance**: Contextual recommendations generated deterministically (e.g., "Grow emergency buffer to 3 months before accelerating discretionary investing").
- **Historical Score Trend**: Tracks score progression over time.

### Domain Engine & Architecture

- **Engine**: [`src/domain/analytics/financialHealthEngine.ts`](../../src/domain/analytics/financialHealthEngine.ts)
- **Service**: [`financialHealthService.ts`](../../src/domain/analytics/financialHealthService.ts)
- **Primary Page**: [`FinancialHealthPage.tsx`](../../src/pages/FinancialHealthPage.tsx)

---

## Feature 008: PWA Web Share Target

### Overview

Native OS integration enabling users on Android, Windows, and macOS to share receipts, bank SMS text, and transaction confirmation URLs directly into MyFin.

### Key Capabilities

- **Service Worker Share Handler**: Registered via `public/sw-share-target.js` to process incoming POST multipart share actions.
- **Quick-Add Text Parsing**: Rule-based parser extracting amount, direction, merchant and — when the message states one — the date (day-first: `12/10/2026`, `12-Oct-26`, `2026-10-12`) from shared SMS/text snippets, e.g. "Rs.500 debited from A/c XX1234 to AMAZON on 12/10/2026". Amounts are read in rupees (`Rs`, `INR`, `₹`, or a bare number after a verb such as "debited"); other currencies are not recognised. A message without a date is dated today. Parsing a new message replaces every field, so nothing from the previous message lingers.
- **Direct Receipt Ingestion**: Automatically attaches shared photos/screenshots to a new transaction draft.

### Domain Engine & Architecture

- **Service Worker**: [`public/sw-share-target.js`](../../public/sw-share-target.js)
- **Parser**: [`src/domain/parser/quickAddParser.ts`](../../src/domain/parser/quickAddParser.ts)
- **Primary Page**: [`ShareTargetLandingPage.tsx`](../../src/pages/ShareTargetLandingPage.tsx), [`QuickAddPage.tsx`](../../src/pages/QuickAddPage.tsx)

---

## Feature 009: Multi-Account File Import

### Overview

Enterprise-grade CSV and Excel file importer capable of ingesting statements from multiple banks and credit cards in a single upload.

### Key Capabilities

- **Multi-Account Column Mapping**: Visual column mapping interface with automatic header recognition (fuzzy matching dates, descriptions, credits/debits, balances, account names).
- **Remembered Column Mapping**: After an import, the date/amount/description/account columns, the amount convention (single signed column or separate debit/credit) and the date format are remembered for files with the same headers (compared ignoring case, spacing and column order). The next such file arrives already mapped, with a note saying so and a "Forget saved mapping" button; a file with an added, removed or renamed column is treated as a new layout and asked about again, never half-guessed. The destination account is deliberately not remembered, and "Remember these columns" can be unticked per import. Stored encrypted and device-local (not in backups); cleared by "Clear everything".
- **Per-Row Account Resolution**: Routes transactions to existing accounts based on file columns or allows mapping unknown accounts to new ledger accounts on the fly.
- **Intelligent Duplicate Detection**: Flags (never silently drops) a likely duplicate: the same amount on the same account within a day, or the same bank reference number (UPI/UTR) on any account within five days. Captured messages are different: the same reference number is the same payment, so a replayed or re-posted copy is folded into the entry it belongs to rather than filed again, and a statement row quoting a captured entry's reference is flagged even when the bank posted it days later. A captured entry whose account was only guessed is also checked against every other account.
- **Review Queue**: Imported transactions land in an unreviewed queue allowing batch verification. Entries in the queue already count toward balances and reports; confirming one marks it as checked. Each entry can be corrected first with the pencil (Edit): account, type, amount, date, merchant, category, tags and notes. Saving an edit does not confirm the entry, and does not teach the categorization engine — Confirm does that, once.
- **Long Queues, a Page at a Time**: After a big import the queue loads newest-first in slices of 50 ("Show N more" brings in the rest, keeping what you have typed on the rows already open), so only what is on screen is decrypted and drawn; splits and tags come in one query each rather than one per row. "Confirm all categorized" reaches the whole queue — the prompt says how many entries it covers beyond the page on screen, and those are confirmed exactly as filed.
- **Cheaper Keyword Rules**: The rule dialog's live preview reads the uncategorized entries once per dialog instead of on every keystroke, and applying rules to the queue picks its candidates off indexed columns before decrypting anything.

### Domain Engine & Architecture

- **Engine**: [`src/data/io/importService.ts`](../../src/data/io/importService.ts), [`src/data/io/bulkTextImportService.ts`](../../src/data/io/bulkTextImportService.ts)
- **Primary Pages**: [`ImportPage.tsx`](../../src/pages/ImportPage.tsx), [`ReviewPage.tsx`](../../src/pages/ReviewPage.tsx), [`BulkTextImportPage.tsx`](../../src/pages/BulkTextImportPage.tsx)

---

## Feature 010: Lending & Borrowing (Person Loans)

### Overview

Peer-to-peer debt and loan ledger tracking money lent to or borrowed from friends, family, and associates.

### Key Capabilities

- **Contacts Directory**: Manage individual borrowers and lenders.
- **Loan Types**: Lent (assets / receivables) and Borrowed (liabilities / payables).
- **Ledger Integration**:
  - Initial disbursement links to a bank account (lowering bank balance for lent, increasing for borrowed).
  - Repayments log real ledger transactions updating account balances.
- **Repayment Milestones**: Remaining balance, repayment logs, due dates, and settlement status.
- **Settle in Full**: One click clears everything still owed (collect from a borrower, or pay back a lender) into a chosen account and date; partial repayments default to the remaining balance.
- **Edit & Remove**: A loan's due date and notes can be edited; a mis-recorded loan can be removed (with its repayments and ledger movements, restoring the account balance).

### Domain Engine & Architecture

- **Engine**: [`src/domain/personLoans/loanProgress.ts`](../../src/domain/personLoans/loanProgress.ts)
- **Repository**: [`personLoanRepository.ts`](../../src/data/dexie/personLoanRepository.ts)
- **Primary Page**: [`PeoplePage.tsx`](../../src/pages/PeoplePage.tsx)

---

## Feature 011: Year In Review Report & PDF Export

### Overview

Annual financial retrospective presenting rich interactive infographics of spending patterns, net worth milestones, top merchants, and printable PDF exports.

### Key Capabilities

- **Annual Aggregation**: Total income, total expenses, savings rate, and net savings for any calendar year.
- **Top Merchant & Category Breakdown**: Visual rankings of top spending categories and frequent payees.
- **Month-by-Month Flow Trends**: Bar/line visual charts comparing inflow vs outflow across all 12 months.
- **Vector PDF Generation**: Generates clean, multi-page vector PDF summaries via `jspdf` and `jspdf-autotable` entirely client-side.

### Domain Engine & Architecture

- **Engines**: [`src/domain/reports/reportEngine.ts`](../../src/domain/reports/reportEngine.ts), [`src/domain/reports/reportService.ts`](../../src/domain/reports/reportService.ts)
- **PDF Generator**: [`src/data/io/reportPdfExport.ts`](../../src/data/io/reportPdfExport.ts)
- **Primary Page**: [`AnalyticsPage.tsx`](../../src/pages/AnalyticsPage.tsx)

---

## Feature 012: Tag Taxonomy & Search Engine

### Overview

Flexible non-hierarchical tagging system allowing multidimensional transaction labeling and instant intersection filtering.

### Key Capabilities

- **Multi-Tag Association**: Assign arbitrary tags (e.g. `#tax-deductible`, `#vacation-2026`, `#reimbursable`) to any transaction.
- **Tag Filter Engine**: Supports multi-select tag filtering with `AND` (intersection) and `OR` (union) operations.
- **Fast Indexed Queries**: Backed by Dexie inverted index tables for immediate sub-millisecond filtering across tens of thousands of transactions.
- **Tag Management**: Color assignment, renaming, merging, and bulk untagging.

### Domain Engine & Architecture

- **Engine**: [`src/domain/transactions/tagFilterEngine.ts`](../../src/domain/transactions/tagFilterEngine.ts)
- **Repository**: [`tagRepository.ts`](../../src/data/dexie/tagRepository.ts)
- **Primary Page**: Integrated into [`TransactionsPage.tsx`](../../src/pages/TransactionsPage.tsx)

---

## Feature 013: Saved Transaction Filter Presets

### Overview

Customizable view presets allowing users to save, name, and switch between complex search, date, account, and category filter configurations.

### Key Capabilities

- **Filter View Persistence**: Save active search query, date ranges, account filters, category selections, amount bounds, and tag filters as a named view.
- **Quick-Switch Pill Bar**: Switch between views with a single click at the top of the transaction register.
- **Default View Selection**: Configure a specific view (e.g. "Unreviewed This Month") as the default landing view.
- **Full CRUD Support**: Create, rename, update criteria, or delete saved filter views.

### Domain Engine & Architecture

- **Repository**: [`savedFilterViewRepository.ts`](../../src/data/dexie/savedFilterViewRepository.ts)
- **Primary Page**: [`TransactionsPage.tsx`](../../src/pages/TransactionsPage.tsx)

---

## Feature 014: Interactive Quick Tour & Onboarding

### Overview

Guided interactive walkthrough overlay introducing new users to the interface, navigation layout, security model, and key workflows.

### Key Capabilities

- **Spotlight Highlights**: Elements are spotlighted with clipped SVG backdrop overlays while focusing on key target UI components.
- **Step Navigation**: Next, Back, Skip, and Finish controls with keyboard accessibility (Escape to dismiss, Arrow keys to navigate).
- **Tour Steps**:
  1. Welcome & Local-First Philosophy
  2. Accounts & Balances
  3. Quick Transaction Add
  4. Budget Management
  5. Analytics & Health Score
  6. Settings & Encrypted Backups
- **Replayable**: Can be restarted at any time from the app settings or help menu.

### Domain Engine & Architecture

- **Components**: [`QuickTourProvider.tsx`](../../src/components/quick-tour/QuickTourProvider.tsx), [`QuickTourOverlay.tsx`](../../src/components/quick-tour/QuickTourOverlay.tsx)
- **Step Config**: [`src/components/quick-tour/tourSteps.ts`](../../src/components/quick-tour/tourSteps.ts)
- **Hook**: [`useQuickTour.ts`](../../src/hooks/useQuickTour.ts)

---

## Feature 015: Starter Setup Template Export & Import

### Overview

Export and import sanitized, reusable configuration templates (categories, accounts structure, categorization rules, recurring schedules, and sample budgets) without exporting private financial transactions.

### Key Capabilities

- **Sanitized Template Creation**: Strips personal transaction histories, balances, attachment blobs, and user identifiers, exporting only structural metadata.
- **Starter Template Library**: Bundled with a verified default template (`SAMPLE_DATA_TEMPLATE`) for immediate first-run setup.
- **UUID Remapping & Conflict Resolution**: Automatically resolves ID collisions and remaps foreign key references during template import.
- **Pre-Import Review**: Displays summary card showing how many accounts, categories, and rules will be added before committing to database.

### Domain Engine & Architecture

- **Service**: [`src/data/io/templateService.ts`](../../src/data/io/templateService.ts)
- **Types**: [`src/data/io/templateTypes.ts`](../../src/data/io/templateTypes.ts)
- **Starter Sample**: [`src/data/io/sampleTemplate.ts`](../../src/data/io/sampleTemplate.ts)
- **Primary Pages**: [`ExportPage.tsx`](../../src/pages/ExportPage.tsx), [`BackupSettingsPage.tsx`](../../src/pages/BackupSettingsPage.tsx)

---

## Feature 016: Core Workflow Improvements

### Overview

A bundle of seven targeted fixes and additions to the daily-use workflow: transaction list readability, Review-queue performance, recurring-from-review, account editing, budget correctness/history, a full data reset, and richer investment tracking.

### Key Capabilities

- **Readable Transaction Rows**: Recent Transactions (Dashboard) and the Transactions table truncate long descriptions and keep the "Unreviewed" badge, date, and amount from ever overlapping, at any screen width.
- **Responsive Review Queue**: Confirming or discarding a transaction in Review now patches local state instead of re-fetching and re-decrypting the entire unreviewed queue on every click — fixes multi-second hangs at hundreds of unreviewed transactions.
- **Mark as Recurring from Review**: A transaction can be turned into a recurring rule directly from Review via a short frequency/day confirm step; an already-linked transaction shows "Already recurring" instead of offering a duplicate.
- **Account Editing**: The Accounts section gained an Edit dialog alongside its existing view/add/archive/delete actions.
- **Correct, Browsable Budgets**: Importing data no longer trusts a file's stale `actualAmount` — it's always recomputed from the destination's own transactions. A month selector lets budgets be browsed for any prior period, computed on demand.
- **Clear All Data**: A single, doubly-confirmed action wipes every table — financial data and the PIN/security vault — returning the app to true first-run onboarding.
- **Investment Type Dropdown + Units/Avg Price**: `type` is now a fixed dropdown instead of free text; holdings track units and a weighted-average price, recalculated on each additional purchase, plus a validated sell path that can never take units negative. Legacy free-text types are mapped onto the fixed list on import.

### Domain Engine & Architecture

- **Engines**: [`budgetEngine.ts`](../../src/domain/budgets/budgetEngine.ts) (`ensureBudgetItemForPeriod`), [`recurringEngine.ts`](../../src/domain/recurring/recurringEngine.ts) (`createRuleFromTransaction`), [`wealthEngine.ts`](../../src/domain/wealth/wealthEngine.ts) (`recordPurchase`/`recordSale`)
- **Data Layer**: [`clearAllTables.ts`](../../src/data/dexie/clearAllTables.ts), [`resetService.ts`](../../src/data/io/resetService.ts), import-time budget recompute and investment type mapping in [`templateService.ts`](../../src/data/io/templateService.ts)
- **Primary Pages**: [`DashboardPage.tsx`](../../src/pages/DashboardPage.tsx), [`TransactionsPage.tsx`](../../src/pages/TransactionsPage.tsx), [`ReviewPage.tsx`](../../src/pages/ReviewPage.tsx), [`AccountsPage.tsx`](../../src/pages/AccountsPage.tsx), [`BudgetsPage.tsx`](../../src/pages/BudgetsPage.tsx), [`BackupSettingsPage.tsx`](../../src/pages/BackupSettingsPage.tsx), [`InvestmentsPage.tsx`](../../src/pages/InvestmentsPage.tsx)

---

## Feature 017: Financial Visibility & Control Enhancements

### Overview

A bundle of five visibility and control gaps closed across credit cards, net worth, budgets, investments, and imports: credit limit/utilization tracking, a categorized net worth breakdown with duplicate-debt detection, budget editing with historical-period protection, portfolio-level investment aggregates, and identifier-based auto-matching of imported/pasted credit card transactions to the right account.

### Key Capabilities

- **Credit Card Limit & Utilization**: Credit card accounts gain an optional credit limit and billing cycle day. Wherever a card's balance is shown, the app displays amount used, amount available, and a utilization percentage; cards at ≥90% utilization or over their limit are visually flagged. A temporarily positive balance (overpayment/refund) clamps to ₹0 used / 100% available rather than showing negative usage. Cards with no limit set still show amount used, with a prompt to add a limit.
- **Categorized Net Worth Breakdown**: Net worth is broken into labeled, drillable subtotals — cash/bank balances, credit card debt, investment value, loans lent, loans borrowed, and other liabilities — that sum exactly to the displayed total, instead of one opaque figure. A transaction-linked credit card account is the single source of truth for its debt.
- **Duplicate Credit Card Debt Detection**: When a manually-entered liability looks like it represents the same real card as an existing transaction-linked account (by name, nickname, or last-4 match), the user is warned and can either link the liability to the account (so only the account counts toward net worth) or dismiss the warning to keep both counted independently.
- **Budget Edit & Delete**: Existing budgets can be edited (amount, category, period type, rollover) and removed after a confirmation step. Edits apply to the current and future periods only — already-closed historical periods keep the figures that were actually budgeted at the time (fixes a latent bug where browsing budget history after an edit could silently rewrite a closed period's planned amount). Two active budgets for the same category/period are prevented.
- **Automatic Net Worth History**: Net worth history builds itself — the first time the app is unlocked each day (or Net Worth is opened) records that day's point, once, never overwriting one already taken, and recording nothing for an empty ledger. "Record snapshot" refreshes today's point instead of adding a duplicate.
- **Investment Portfolio Aggregates**: The Investments view shows total current value, total invested (cost basis), and total gain/loss (currency and percentage) across all holdings, broken down further by investment type. Holdings without a recorded valuation fall back to cost basis and are visually marked as an estimate.
- **Trades Through an Account**: "Buy more units" can take the cost out of a bank, cash or wallet account, and "Sell units" can add the proceeds to one (with a sale price), in the same step — the account's side is posted as a transfer-type ledger entry (not spending, not income, so budgets and reports are unaffected) tied to the holding, so it can't be edited or deleted on its own. With no account chosen, only the holding changes. The holding's Edit dialog lists its purchases and sales, and the latest can be undone: units, average price, cost basis, the recorded value it adjusted and the account entry all go back. Editing a holding's units or price outright clears that list (the entries stay as ordinary ledger entries).
- **Goal Contributions Are Tracking Only**: Logging a savings-goal contribution says so (it does not move money or change a balance) and links to Transfer for moving the money itself — a goal is not part of net worth, so debiting an account for it would have made net worth fall.
- **Value Follows Units**: Buying or selling units moves a holding's recorded value with them — a purchase adds what it cost (so the money put in is not reported as a loss), a sale scales the value to the units that remain, and selling everything takes it to nothing — instead of leaving the old value counting toward net worth. A holding with no recorded value is valued at its cost basis, which already follows its units.
- **Edit and Delete Holdings**: A holding can be corrected after it is added — name, type, and the units and average price it was entered with (its cost basis follows; a legacy unit-less holding edits its cost basis directly). Delete takes it, and its recorded values, out of the portfolio and net worth after a confirmation (the ledger entries of its trades stay as ordinary entries). "Update value" starts from the current value, entering a value again the same day replaces that day's value (it used to leave two with no defined winner), and the Edit dialog lists the recorded values so a wrong one can be deleted. The cost basis is the money actually paid, added up exactly on each purchase (the average price is worked out from it) and cut to the remaining share on a sale, so it does not drift with the rounded average. A holding that only has a cost basis cannot be bought into until it is given its units (Edit → "Units held"), which keeps the money already invested instead of replacing it.
- **Credit Card Identifier Matching for Imports**: Credit card accounts can be tagged with a last-4-digit identifier and/or a nickname. Both the CSV/XLSX importer and the paste-based bulk text importer scan incoming content for a tagged identifier and pre-select the matching card as the destination, showing which identifier matched and why; an ambiguous match (multiple cards) prompts the user to disambiguate, and an unmatched import falls back to manual account selection without being blocked. A single file can route different rows to different matched cards.

### Domain Engine & Architecture

- **Engine**: [`src/domain/wealth/wealthEngine.ts`](../../src/domain/wealth/wealthEngine.ts) (`computeCardUtilization`, `computeNetWorth`, `findLikelyDuplicateAccounts`, `linkLiabilityToAccount`, `dismissDuplicateWarning`, `computePortfolioSummary`)
- **Matcher**: [`src/domain/parser/cardIdentifierMatcher.ts`](../../src/domain/parser/cardIdentifierMatcher.ts) (`findCardMatches`)
- **Budget Engine**: [`src/domain/budgets/budgetEngine.ts`](../../src/domain/budgets/budgetEngine.ts)
- **Repositories**: [`wealthRepository.ts`](../../src/data/dexie/wealthRepository.ts), [`budgetRepository.ts`](../../src/data/dexie/budgetRepository.ts) (`remove`), [`accountRepository.ts`](../../src/data/dexie/accountRepository.ts) (`creditLimit`, `billingCycleDay`, `cardLast4`, `cardNickname`)
- **Import Integration**: [`importService.ts`](../../src/data/io/importService.ts), [`bulkTextImportService.ts`](../../src/data/io/bulkTextImportService.ts)
- **Primary Pages**: [`AccountsPage.tsx`](../../src/pages/AccountsPage.tsx), [`LiabilitiesPage.tsx`](../../src/pages/LiabilitiesPage.tsx), [`NetWorthPage.tsx`](../../src/pages/NetWorthPage.tsx), [`BudgetsPage.tsx`](../../src/pages/BudgetsPage.tsx), [`InvestmentsPage.tsx`](../../src/pages/InvestmentsPage.tsx), [`ImportPage.tsx`](../../src/pages/ImportPage.tsx), [`BulkTextImportPage.tsx`](../../src/pages/BulkTextImportPage.tsx)

---

## Feature 018: Financial Planning & Productivity Enhancements

### Overview

Seven independently-shippable additions spanning passive insight (subscriptions, forecasting), budgeting depth (variance reporting, envelope rollover), and everyday usability (quick search, a customizable dashboard, unattended local backups) — each reusing an existing domain engine as its foundation rather than introducing a parallel one.

### Key Capabilities

- **Subscription Tracker** (now part of the Recurring page, see Feature 024): Detects merchants with a repeating amount/interval charge pattern directly from existing transaction history — no manual recurring-rule setup. Groups charges by merchant (or normalized description text when no merchant is resolved), classifies a cadence (weekly/monthly/quarterly/yearly) within a tolerance window, and flags a subscription as possibly lapsed once it's overdue for its own cadence. Shows total detected monthly cost, and a merchant can be dismissed from the view without touching its transactions. Credit card bill payments (recognised by description or merchant name) are never reported as subscriptions.
- **Cash-Flow Forecasting**: Projects an account's balance 30/60/90 days out by combining its scheduled recurring transactions (deterministic) with a trailing-average "drift" term for ordinary non-recurring spend (averaged over the account's last 90 days, or over the 30 to 90 days it has existed, so a new account's spending is not spread over 90), and warns in advance of the first date a configurable low-balance threshold would be crossed. For a **credit card** the projection is its amount owed — the trend includes the card's bill payments — and the warning is against its credit limit (none if no limit is set) rather than a low-balance threshold. Marks a forecast low-confidence rather than fabricating a projection when an account has too little recurring/historical signal.
- **Budget vs. Actual Variance Report**: A dedicated month-range report distinct from the general Analytics page, showing budgeted, actual, and variance per category with over/under/on-track/unbudgeted status — a category with real spend but no budget is never silently folded into zero-variance, and a budgeted category with zero spend is never omitted.
- **Envelope Rollover Budgeting**: Extends the existing (positive-only) budget rollover with an opt-in "full" mode that also carries an overspend deficit into the next period, alongside the original "roll over surplus only" behavior and the default "off." The rolled-over amount (positive or negative) is always shown as a line distinct from the period's base budget, and disabling rollover on a category with an accumulated balance requires an explicit confirmation explaining what happens to it.
- **Global Command Palette**: A Ctrl+K/Cmd+K keyboard-accessible overlay searching transactions, payees, and accounts, built on an in-memory index (Dexie's encrypted-field indexes are exact-match only, so ciphertext can't be substring-searched) that's rebuilt on every palette open and exists only inside the authenticated app shell — structurally unreachable while the app is locked.
- **Customizable Dashboard Widgets**: The Dashboard's cards are config-driven instead of fixed — users can hide, show, and reorder widgets from a settings sheet, with the layout persisted across sessions. At least one core widget always stays visible, and an unrecognized or missing widget id in a stored layout is handled gracefully rather than breaking the page.
- **Scheduled Local Encrypted Backups**: An optional automatic backup to a folder on the same device (via the File System Access API), reusing the existing manual export's encryption path unchanged. Because the backup encryption key is derived from the plaintext PIN — which is never stored — an automatic backup can only run at the moment of a successful PIN unlock, not on a background timer; this is surfaced honestly via a last-successful-backup timestamp rather than implying a stronger guarantee. Gracefully explains when a browser doesn't support the underlying API.

### Domain Engine & Architecture

- **Engines**: [`subscriptionDetectionEngine.ts`](../../src/domain/recurring/subscriptionDetectionEngine.ts) (`detectSubscriptions`), [`forecastEngine.ts`](../../src/domain/forecast/forecastEngine.ts) (`projectAccountBalance`), [`budgetVarianceEngine.ts`](../../src/domain/budgets/budgetVarianceEngine.ts) (`computeVarianceReport`), [`budgetEngine.ts`](../../src/domain/budgets/budgetEngine.ts) (extended with `rolloverMode`'s deficit-carry), [`searchIndex.ts`](../../src/domain/search/searchIndex.ts) (`buildSearchIndex`/`querySearchIndex`), [`dashboardLayout.ts`](../../src/domain/analytics/dashboardLayout.ts) (`resolveDashboardLayout`)
- **Data Layer**: [`autoBackupSettingsRepository.ts`](../../src/data/dexie/autoBackupSettingsRepository.ts), [`autoBackupService.ts`](../../src/data/io/autoBackupService.ts) (`maybeRunScheduledBackup`, reusing `backupService.ts`'s `createBackup` unchanged), Dexie schema v12 (`autoBackupSettings` table)
- **Primary Pages**: [`RecurringPage.tsx`](../../src/pages/RecurringPage.tsx) (subscriptions), [`CashFlowForecastPage.tsx`](../../src/pages/CashFlowForecastPage.tsx), [`BudgetVarianceReportPage.tsx`](../../src/pages/BudgetVarianceReportPage.tsx), [`BudgetsPage.tsx`](../../src/pages/BudgetsPage.tsx), [`DashboardPage.tsx`](../../src/pages/DashboardPage.tsx), [`BackupSettingsPage.tsx`](../../src/pages/BackupSettingsPage.tsx)
- **Components**: [`CommandPalette.tsx`](../../src/components/CommandPalette.tsx), [`DashboardCustomizeSheet.tsx`](../../src/components/DashboardCustomizeSheet.tsx)

---

## Feature 020: Android Fingerprint Unlock, Editable Review & Auto-capture

### Overview

Three changes aimed at the Android APK. Fingerprint unlock did not work there at all (the browser's WebAuthn does not exist inside Android WebView), Review could only change a category and tags, and bank SMS could only get into MyFin by being pasted.

### Key Capabilities

- **Fingerprint unlock on Android**: A local `NativeBiometric` plugin uses Android's `BiometricPrompt` with a Keystore key that needs a fresh strong-biometric check for every use. The plugin holds a random secret behind that key; the app wraps the PIN with it. The PIN itself never reaches native code, and the PIN keeps working. Adding or removing a fingerprint in Android settings invalidates the key on purpose: the app says so, drops the enrollment, and asks for the PIN. A wrapped PIN that no longer opens (for example after restoring a backup) is treated the same way and does **not** count as a wrong PIN.
- **Locks when you have been away**: The inactivity timer cannot be trusted while the app is in the background, so the session also keeps a wall-clock deadline and checks it when the app returns to the foreground. Away longer than your auto-lock time (default 5 minutes, now adjustable under **Security**) shows the lock screen and opens the fingerprint prompt by itself, once per return; coming back sooner does not ask again.
- **Security page**: Turn fingerprint unlock on (after re-entering the PIN) or off, see why it is unavailable (no sensor, no fingerprint enrolled, too weak a sensor, …), and set the auto-lock time.
- **Edit in Review**: Every card has an **Edit** button opening the full edit dialog (account, type, amount, date, merchant, category, tags, notes). Saving does not confirm the entry; Confirm is a separate step. An edit to an entry still in Review does not feed the categorization learning (Confirm does, once). The Review copy now says what was always true: waiting entries already count toward balances and reports.
- **Auto-capture (APK only)**: Incoming bank SMS and notifications from payment/banking apps (and bank alerts shown by your messages app, which covers alerts that arrive over RCS) are turned into Review entries automatically. Only messages that look like completed transactions are kept; one-time codes, offers, balance alerts, failures, reminders and chat from people are never stored (a bank alert forwarded from a number is kept). One payment seen both as an SMS and as an app notification becomes one entry that shows both. A likely duplicate of an existing entry is created and flagged, never silently skipped. The original message is shown on the card. Accounts are matched by the digits a message names (`A/c XX1234`, `card ending 5678`), which you can save on each account; anything else lands on a default account you choose and is marked **Account not matched — check**. A small alert says how many are waiting, without any amount or merchant.
- **Safe while locked**: Receivers run with no PIN and no key, so each message is locked on arrival with a public key; the matching private key is stored encrypted with your PIN-derived key. Nothing readable is kept until you unlock, then the queue is opened, filed and acknowledged.
- **Honest about Android's limits**: Sideloaded apps can be blocked from reading SMS and notifications (Android's "restricted settings"); the Auto-capture page explains how to allow it and links to the right screens.

### Domain Engine & Architecture

- **Biometric**: [`src/lib/biometric.ts`](../../src/lib/biometric.ts) (provider choice, reasons), [`src/lib/native/nativeBiometric.ts`](../../src/lib/native/nativeBiometric.ts), [`src/lib/pinWrap.ts`](../../src/lib/pinWrap.ts), native `NativeBiometricPlugin.java` / `BiometricVault.java`
- **Session**: [`SessionContext.tsx`](../../src/context/SessionContext.tsx) (`lockIfExpired`, `setAutoLockTimeout`), [`appState.ts`](../../src/lib/native/appState.ts), [`useAppActive.ts`](../../src/hooks/useAppActive.ts)
- **Capture domain**: [`src/domain/capture/`](../../src/domain/capture/) (`captureFilter`, `captureParser`, `accountMatcher`, `capturePairing`, `originalMessage`)
- **Capture data layer**: [`captureIngestService.ts`](../../src/data/io/captureIngestService.ts), [`captureDrain.ts`](../../src/data/io/captureDrain.ts), [`captureSetup.ts`](../../src/data/io/captureSetup.ts), [`sealedBox.ts`](../../src/data/crypto/sealedBox.ts)
- **Native capture**: `android/app/src/main/java/io/github/akhlaquea01/myfin/capture/` (`SmsReceiver`, `NotificationCaptureService`, `SealedBox`, `CaptureFilter`, `CaptureQueue`, `CaptureNotifier`, `TransactionCapturePlugin`)
- **Pages**: [`SecurityPage.tsx`](../../src/pages/SecurityPage.tsx), [`AutoCapturePage.tsx`](../../src/pages/AutoCapturePage.tsx), [`ReviewPage.tsx`](../../src/pages/ReviewPage.tsx), [`AccountsPage.tsx`](../../src/pages/AccountsPage.tsx) (account digits)

---

## Feature 021: QA Hardening — Recovery, Durability & Everyday Flow

### Overview

A pass over the app's flows (onboarding, lock, entry, Review, backup, notifications, auto-capture) that closed gaps where a user could lose data, lose access, or be left on a dead end. The larger items are listed first.

### Key Capabilities

- **Change PIN and Forgot PIN**: **Security → Change PIN** verifies the current PIN (counted toward the same lockout as the lock screen), then re-encrypts every row, the captured-message sealing key and the profile under the new PIN in a single transaction; a failure leaves the old PIN and data untouched. Fingerprint unlock turns off (it wrapped the old PIN) and the session is locked. The lock screen's **Forgot your PIN?** explains that nothing can recover the PIN and offers an erase-and-start-over behind a typed `DELETE EVERYTHING`.
- **Backup durability**: A backup is opened and verified with its PIN before it is handed to the share sheet. The Backup page shows how long ago the last backup was, and on Android says plainly that uninstalling, clearing storage or changing phones erases the data. **Remind me weekly** schedules a fixed-text Android notification (no amounts or merchants) and shows a Dashboard banner whenever the last backup is a week old or missing. Restore warns that the PIN, fingerprint and auto-lock settings revert to the backup's, and refuses files too large to be a backup.
- **Lock when I leave the app**: An opt-in switch under Security → Auto-lock locks the app after 30 seconds out of the foreground (long enough for permission prompts and file pickers), regardless of the inactivity timer.
- **New Transaction**: A category chosen without an amount takes the whole total instead of being dropped; split totals that do not add up are explained in rupees ("500.00 still to allocate"); tags or a shared photo failing after the transaction saved are reported as "saved, but…" and the page moves on, so a retry cannot create a duplicate. The amount starts empty, there is a Cancel button, and a shared photo can be removed.
- **Review**: Confirm and Discard are guarded against double taps and report failures; reloads after applying a rule or confirming in bulk no longer wipe categories and tags typed on other cards; **Confirm all categorized** leaves flagged entries (possible duplicates, captures filed on a guessed account) for a human look and says how many it left. An empty queue points to Quick Add, Import and Auto-capture.
- **First run**: The Dashboard shows a **Get started** card until there is an account, with a one-click **Add common categories** (idempotent, matched by name). The biometric offer is snoozed for 30 days when declined, and the tour, biometric offer and notification offer appear one at a time rather than together.
- **Navigation**: Grouped menu; on phones a bottom bar (Home, Activity, +, Check, More) with an Add menu (new transaction, paste a bank message, transfer). The Dashboard's Unreviewed card opens Review; Total Balance opens Accounts; Recent Transactions has View all. Unknown addresses show a Not-found page. On Android the Back button closes an open dialog or drawer first, then goes back, then leaves the app from the Dashboard.
- **Notifications**: Tapping an Android notification opens the matching screen. The Notifications page validates its fields inline and shows whether the device allows notifications, with an Allow button or a way to the system settings.
- **Auto-capture**: A banner appears anywhere in the app when capture is on but Android no longer allows it (SMS permission revoked, notification access off). The page explains why waiting messages are not being filed, offers **File them now**, links to Accounts when there is no account to file under, and lets the discarded/overflow notices be cleared. A message that passed the "looks like a transaction" filter but could not be parsed is no longer thrown away: its text is kept (encrypted, newest 100) under **Messages MyFin could not read**, where it can be opened in Quick Add to add by hand, or dismissed.
- **Confirmations**: Every "are you sure?" is one styled in-app dialog whose button names the action ("Delete permanently", "Write off") — red when it cannot be undone — instead of the browser's native confirm box. Deleting a record asks first; there is no Undo afterwards.
- **Rupee sign**: Amounts are shown as `₹1,234.50` / `-₹350.00` everywhere through one formatter (`formatMoney`). The PDF report keeps plain figures, as its built-in font has no rupee glyph. MyFin is INR-only; there is no per-account currency.
- **Bulk text import**: Each pasted line is filed on the date it states ("on 05-Jan-26"), or today if it states none; likely-duplicate checks compare against each line's own date.
- **Dates**: Remaining places that read "today" or "this month" from the UTC date (budget variance default month, report "today", loan overdue, reminder lead time, subscription lapse, forecast, recurring schedule start, backup/export file names) now use the local calendar.

### Needs a device check

The Android-side code below compiled only against stand-ins for the Android and Capacitor APIs here (there is no Android SDK on the dev machine); the GitHub Actions APK build is the first real compile, and the behaviour needs trying on a phone:

- **Automatic backups to a folder** — `NativeBackupFolderPlugin.java` (Storage Access Framework: pick a folder once, write a new encrypted file per scheduled backup).
- **Sharing a CSV or Excel statement into the app** — `NativeSharePlugin.java` and the manifest filter; the file opens in Import. A half-filled form is protected by a confirmation before any share replaces it.

### Not done

- Other currencies: MyFin is INR-only (the sign is shown, but parsing and storage assume rupees). Sharing a PDF statement is not supported either, because Import reads CSV and Excel only.

### Domain Engine & Architecture

- **PIN**: [`changePinService.ts`](../../src/data/io/changePinService.ts), [`pinGate.ts`](../../src/data/auth/pinGate.ts), [`resetService.ts`](../../src/data/io/resetService.ts) (`resetEverything`), [`SessionContext.tsx`](../../src/context/SessionContext.tsx) (`handleAppActiveChange`)
- **Backups**: [`backupReminder.ts`](../../src/lib/backupReminder.ts), [`backupReminderService.ts`](../../src/data/io/backupReminderService.ts), [`BackupNudgeBanner.tsx`](../../src/components/BackupNudgeBanner.tsx)
- **Entry**: [`splitInput.ts`](../../src/domain/transactions/splitInput.ts), [`recurringDay.ts`](../../src/domain/recurring/recurringDay.ts), [`dateText.ts`](../../src/domain/parser/dateText.ts), [`starterCategories.ts`](../../src/data/io/starterCategories.ts)
- **Alerts & confirmations**: [`notificationInboxRepository.ts`](../../src/data/dexie/notificationInboxRepository.ts), [`unreadableCaptureRepository.ts`](../../src/data/dexie/unreadableCaptureRepository.ts), [`AlertsPage.tsx`](../../src/pages/AlertsPage.tsx), [`ConfirmProvider.tsx`](../../src/components/ConfirmProvider.tsx) / [`confirm.ts`](../../src/lib/confirm.ts), Dexie schema v14 (`notificationInbox`, `unreadableCaptures`; both carried by backups and a PIN change)
- **Shell**: [`AppShell.tsx`](../../src/components/AppShell.tsx), [`AndroidBackHandler.tsx`](../../src/components/AndroidBackHandler.tsx), [`NotificationTapHandler.tsx`](../../src/components/NotificationTapHandler.tsx), [`CaptureHealthBanner.tsx`](../../src/components/CaptureHealthBanner.tsx), [`NotFoundPage.tsx`](../../src/pages/NotFoundPage.tsx)

## Feature 022: Clearer Review, Search-as-you-type Categories & a Charted Dashboard

### Overview

Made the captured-message flow quicker to act on and easier to read on a phone: the account is found from the digits in the message, duplicates are told apart by the bank's reference number and can be compared, a category is picked by typing, and the dashboard shows where money went as charts instead of grey numbers.

### Key Capabilities

- **Account from the digits**: "A/c XX1234", "XXXX-1234", a bare "XX1234", "card ending 5678" and five-digit card tails are read and matched to an account's saved digits, in captured messages **and** in Quick Add and bulk text import (which only knew credit-card digits before). A bank account beats a card that shares its digits; the longer tail beats the shorter; digits that fit two accounts are kept as a hint instead of guessed. Choosing the account on a captured entry clears its "account was guessed" flag.
- **Duplicates you can judge**: a flagged entry in Review shows the entry it looks like (date, amount, merchant, account, whether it is still waiting) and why — the same bank reference number, the same merchant, or just the same amount — with **Keep both** and **Same payment — remove this one** (asks first). Confirming an entry settles its flag. See _Intelligent Duplicate Detection_ above for how the match works.
- **Category by typing**: every category field is a search box over the full `Parent › Child` paths — type the start of any word, press Enter for the first match. On a phone it is a bottom sheet with the keyboard already open; from md up it is a popover. Suggestions from your rules are listed first, and each category has a colour dot.
- **Review card**: a coloured arrow and edge (red out, green in, amber when it needs a look), the merchant, a large amount, one status chip, the account as a tappable chip (fix a guessed account in place), a full-width category field and a large Confirm. Tags, Transfer, Recurring, remembering the choice as a rule and the original message are under _More options_. A summary at the top shows how many wait, money out and in, and a bar of what is ready, needs a category or needs a look.
- **Quick Add**: a Category field that starts on what your rules suggest for the merchant, and "Add to review queue" (so "Confirm" only means one thing).
- **Tab bar and toast**: the phone's tab says **Review** and shows how many entries wait; the "new transactions added" message has a Review button.
- **Dashboard charts**: a large balance with its trend; _This month_ (money in, money out, how much of it has gone out — money that came back into a spending category, such as a refund or a friend paying you back, is taken off money out rather than counted as money in, so it always equals the _Where it went_ total); _Where it went_ (a stacked strip and ranked bars per category, top five plus a neutral Other); six months of in vs out as columns you tap for exact figures, with a table view; budget meters that go amber then red and say so in words; tiles for net worth, lending and what is waiting. Widgets can still be hidden or moved; a layout saved before these existed keeps its order and gets them added.
- **Colour**: money in is green and money out is rose everywhere; amber means "needs a look". Each category keeps one of eight fixed hues (checked for colour-blind separation and contrast on the dark surface); a ninth category stays neutral rather than repeat a hue. Budgets, card utilisation and investment allocation use the same meters and strips.
- **Phone navigation**: a scrollable strip of the open screen's siblings (Budgets · Budget vs. Actual · Goals · Recurring · Forecast; Accounts · Transactions · Quick Add · Review; and so on) sits above each page on a phone, so related screens are one tap apart. Every screen keeps its own address and the desktop sidebar is unchanged. Alerts says it is for bills, budgets and loans and points to Review for bank messages.

### Not done

- Per-category colours could not be chosen at the time (Feature 024 added that); inline creation of a category from the picker; learning an account from the sender name for messages without digits.

### Domain Engine & Architecture

- **Capture**: [`captureParser.ts`](../../src/domain/capture/captureParser.ts) (`extractAccountTails`, `extractRefNo`), [`accountMatcher.ts`](../../src/domain/capture/accountMatcher.ts) (`matchCaptureAccount`, `findAccountMatches`), [`capturePairing.ts`](../../src/domain/capture/capturePairing.ts), [`captureIngestService.ts`](../../src/data/io/captureIngestService.ts), [`duplicateCandidates.ts`](../../src/domain/transactions/duplicateCandidates.ts) (`findDuplicateCandidates`, `findByReference`, `duplicateReason`)
- **Categories**: [`CategoryPicker.tsx`](../../src/components/CategoryPicker.tsx), [`categoryHierarchy.ts`](../../src/domain/categories/categoryHierarchy.ts) (`filterCategoryOptions`), [`categoryColor.ts`](../../src/domain/categories/categoryColor.ts)
- **Review**: [`ReviewPage.tsx`](../../src/pages/ReviewPage.tsx), [`DuplicateCompare.tsx`](../../src/components/DuplicateCompare.tsx), [`useWaitingReview.ts`](../../src/hooks/useWaitingReview.ts)
- **Charts**: [`charts/`](../../src/components/charts) (`BarList`, `ProgressBar`, `SegmentedBar`, `TrendBars`), [`dashboardInsights.ts`](../../src/domain/analytics/dashboardInsights.ts), [`dashboardLayout.ts`](../../src/domain/analytics/dashboardLayout.ts), colour tokens in [`index.css`](../../src/index.css)
- **Navigation**: [`hubs.ts`](../../src/lib/hubs.ts), [`HubTabs.tsx`](../../src/components/HubTabs.tsx)
- **Tests**: a `mobile` Playwright project (Pixel 7) runs `tests/e2e/*.mobile.spec.ts`; the desktop project runs the rest.

---

## Feature 023: Audit Hardening — Imports, Integrity & Start-up

Details, findings and remaining risks are in [`AUDIT-LOG.md`](../maintenance/AUDIT-LOG.md).

### Key Capabilities

- **Check my data** (Backup & Restore): re-adds every account from its entries and reports anything that disagrees with itself — a drifted balance, categories that do not add up to an amount, a transfer missing its other half, an invalid date, an entry pointing at an account or category that no longer exists. **Rebuild balances** repairs the one thing that is derived data; everything else is reported, not guessed at.
- **Dates are validated where they are stored**: an empty or impossible date is refused with a message in every form, and by the repository itself, instead of being saved and dropping the entry out of reports.
- **Excel and card-statement imports**: real Excel date, formula and rich-text cells are read; dates may use `YY`, month names (`05-Mar-26`) and a trailing time; a **positive = expense** amount convention covers credit-card statements.
- **Faster start**: each screen loads on demand, so the lock screen no longer downloads the whole app first (entry script 2.4 MB → 0.7 MB). A tab left open across a redeploy reloads once instead of showing a blank page.
- **App shortcuts**: long-press the installed icon for _New transaction_ or _Paste a bank message_.
- **Share target hygiene**: shares nobody collected expire after a day and oversized files are not buffered.

### Domain Engine & Architecture

- **Integrity**: [`integrityService.ts`](../../src/data/io/integrityService.ts), [`DataIntegrityCard.tsx`](../../src/components/DataIntegrityCard.tsx)
- **Dates**: `isValidIsoDate` in [`dateMath.ts`](../../src/domain/shared/dateMath.ts)
- **Import**: `cellToText`, `parseDateWithFormat` and the `positive-is-expense` convention in [`importService.ts`](../../src/data/io/importService.ts)
- **Code splitting**: `lazyPage` in [`App.tsx`](../../src/App.tsx), [`staleChunk.ts`](../../src/lib/staleChunk.ts)

---

## Feature 024: Purpose Tags, Card Capture, One Recurring Page & a Categories Revamp

### Overview

Five related changes: an expense can be marked as debt, savings, an investment or a bill when it is recorded; credit-card messages are captured and filed on the card; each captured message keeps the time it arrived and the time it states, so duplicates can be judged; Recurring and Subscriptions are one page; and the Categories page shows where the month's money went.

### Key Capabilities

- **Purpose on an expense**: New Transaction, Quick Add, Edit and Review each have a **Purpose** (None, Debt payment, Savings, Investment, Bills) and a **Linked item**. The tag is stored on the transaction and shown as a badge in the Transactions list; the target is updated in the same step:
  - _Debt_: the liability's balance owed falls and a payment is recorded on it, exactly like a payment made on the Liabilities page (which now tags its entry as Debt too). The entry is then managed from Liabilities (undo the payment to change it). Refused when the amount is more than is owed, when paying from a credit card, or for a card tracked as an account.
  - _Savings_: the amount is added to the goal as a contribution that follows the entry when it is edited or deleted.
  - _Bills_: the nearest unpaid payment of the chosen recurring rule is marked as paid, even if the amount differs a little; the choice survives later edits.
  - _Investment_: a tag only (units and price are needed to record a trade).
    Entries waiting in Review keep the tag and apply it when confirmed; a refusal at that point keeps the entry in Review. Only spending can have a purpose. The Analytics page has a **Spending by purpose** card, kept apart from the category figures other screens are built on. A data-template import keeps the tag but not a link to a debt or goal (the payments and contributions are not rebuilt from the file, so applying them again would count twice); the CSV/Excel export gains a `purpose` column.
- **Credit cards in auto-capture**: A message that says "credit card" (or `CC`, Amex, SBI Card…) is filed on your credit-card account even when its digits were never saved — if you have one credit card — and flagged **Card assumed — check**; with several cards it still falls back to the default account. A credit card can now be the default account, so a card-only user can turn capture on, and the "Account not matched" hint shows whenever there are two or more accounts. Card alerts with no "debited/spent" wording ("has been used for a transaction of…", "swiped", "Txn of…", "Thank you for using your card…") are read as charges (the entry says the direction was assumed). Processed e-mandate charges, purchase alerts that end with "see statement" or "never share your OTP", and foreign-currency charges (kept under **Messages MyFin could not read**) are no longer dropped, and the Auto-capture page counts what was ignored and why. Merchant names are read after "on", "towards" and "Info:", and a link or time of day is no longer taken for a merchant. Moving a captured entry to its card offers to save the digits so the next one files itself. Native side: the pre-filter accepts the same wording and stops dropping debit alerts with a fraud-warning footer, and each SMS keeps its own timestamp. A shared fixture of must-accept messages is checked by both the web and Java tests.
- **Message time, for duplicates**: A captured entry stores when the phone received the message, the time of day the message itself states (when it states one) and a hash of the message. Likely duplicates are ranked by how close in time they are (a payment alerted twice minutes apart ranks above one hours apart); Review's comparison card shows both messages' sender, channel and times, and the Transactions list shows the time next to the date. The export has `captured_at` and `payment_at` columns, and a data-template import keeps the capture details.
- **One Recurring page**: Subscriptions is no longer a separate screen. **Recurring** has a "This is a subscription" switch on a rule, filter chips (All, Bills, Income, Subscriptions) once there is more than one kind, a monthly total for tracked subscriptions, and **Found in your history** — repeating charges detected from your transactions, including card charges captured from messages — with **Track** (creates a subscription rule from the latest charge) and Dismiss. Quarterly charges can be dismissed but not tracked yet (rules recur weekly, monthly or yearly). `/subscriptions` redirects to `/recurring?filter=subscriptions`. Every rule card has **Edit** (the same dialog, filled in, with an optional label) and **Delete** (after a confirmation). Changing when a rule recurs drops its reminders still waiting for the old dates and they return on the new ones; payments already matched and due dates already missed are kept. Deleting a rule removes its reminders only: recorded transactions stay, an entry that was marked as this bill keeps its Bills tag but stops naming the deleted rule, and the entry that created the rule is no longer shown as "already recurring".
- **Categories page**: Spending and Income lists with a month stepper; a summary of the month's total, how it changed on the month before and a bar of the top categories; a card per category with its icon and colour, spend, transaction count, budget meter (or a "Set a budget" link) and its subcategories folded in; search and ordering. Add and edit open in a bottom sheet on a phone. A category can be renamed, moved under another, given one of eight colours and an icon. **Merge into…** and **Delete** ask where the transactions go; the budget, recurring rules and auto-categorize rules and learning follow them, so nothing is left pointing at a deleted category. Uncategorized money is listed on its own so the totals add up. The starter categories now come with icons, and Salary is an income category.

### Domain Engine & Architecture

- **Purpose**: [`purposeEngine.ts`](../../src/domain/transactions/purposeEngine.ts) (`validatePurpose`, `applyPurpose`, `clearPurpose`, `syncPurpose`) called from [`transactionEngine.ts`](../../src/domain/transactions/transactionEngine.ts); `linkTransactionToRule` in [`recurringEngine.ts`](../../src/domain/recurring/recurringEngine.ts); [`PurposeField.tsx`](../../src/components/PurposeField.tsx); `purposeBreakdown` in [`analyticsEngine.ts`](../../src/domain/analytics/analyticsEngine.ts). The effect on a target is found again through the target's own link to the transaction (`LiabilityPayment.transactionId`, `GoalContribution.transactionId`, `ExpectedEvent.matchedTransactionId`), so applying is repeatable and reversing needs only the transaction.
- **Capture**: [`captureParser.ts`](../../src/domain/capture/captureParser.ts) (instrument, direction fallbacks, merchant), [`accountMatcher.ts`](../../src/domain/capture/accountMatcher.ts) (`soleCreditCard`, `suggestAccountTag`), [`captureFilter.ts`](../../src/domain/capture/captureFilter.ts), [`captureMoment.ts`](../../src/domain/capture/captureMoment.ts), [`dateText.ts`](../../src/domain/parser/dateText.ts) (`parseTimeFromText`), [`duplicateCandidates.ts`](../../src/domain/transactions/duplicateCandidates.ts); native `CaptureFilter.java`, `SmsReceiver.java`; shared test fixture [`tests/fixtures/captureAcceptCases.txt`](../../tests/fixtures/captureAcceptCases.txt).
- **Recurring**: [`subscriptionDetectionEngine.ts`](../../src/domain/recurring/subscriptionDetectionEngine.ts) (`excludeTracked`, `ruleFromDetected`, `toMonthlyCost`), [`recurringEngine.ts`](../../src/domain/recurring/recurringEngine.ts) (`updateRecurringRule`, `deleteRecurringRule`), [`RecurringPage.tsx`](../../src/pages/RecurringPage.tsx).
- **Categories**: [`categoryEngine.ts`](../../src/domain/categories/categoryEngine.ts) (`moveAndRemoveCategory`), [`categoryOverview.ts`](../../src/domain/categories/categoryOverview.ts), `categoryActivity` in [`analyticsEngine.ts`](../../src/domain/analytics/analyticsEngine.ts), [`categoryColor.ts`](../../src/domain/categories/categoryColor.ts), [`src/components/categories/`](../../src/components/categories), [`CategoriesPage.tsx`](../../src/pages/CategoriesPage.tsx).
- **No schema change.** Every new field (`Transaction.purpose`, `CaptureInfo.txnAt`/`msgHash`/`directionGuessed`, `GoalContribution.transactionId`, `RecurringRule.isSubscription`, `Category.color`/`kind`, `CaptureSettings.ignoredCounts`) is optional and lives inside the encrypted row, so older data and backups load unchanged and a backup carries them automatically.

### Needs a device check

- The native filter and SMS receiver changes were checked by compiling `CaptureFilter.java` and running the shared cases against it with plain `javac`; the Gradle unit tests and the SMS/notification paths themselves need an Android build and a phone.
- The bank SMS wording used in the tests is from memory of common card alert formats; **Auto-capture → Messages MyFin could not read** shows what a real phone could not parse.

---

## Feature 025: A Shorter Sidebar — Data, Automation & Settings

### Overview

The sidebar's last group, "Data & settings", listed nine links. It is now **Manage**, with three entries, and each opens the first of its screens with a strip of the others along the top of the page. The sidebar went from 27 links to 22 (26 to 22 on the web, where Auto-capture does not exist).

### Key Capabilities

- **Data**: Import, Bulk import, Export, Backup. The entry opens Import.
- **Automation**: Auto-capture (Android app only), Auto-Categorize, Notifications. The entry opens Auto-capture in the app and Auto-Categorize on the web.
- **Settings**: Security, About.
- **Categories** moved up beside Accounts and Transactions: it organises the ledger and is opened far more often than the rest of the old group.
- **Same strip everywhere**: the phone already showed a strip of sibling screens above each page. A hub marked `folded` now draws it at every screen size, since the sidebar no longer lists its screens; the other hubs (Money, Plan, Wealth, Insights) keep a phone-only strip and a desktop sidebar that lists every screen. The sidebar entry stays highlighted while any of its screens is open.
- **No address changed**: every screen keeps its URL (`/import`, `/export`, `/backup`, `/notification-settings`, `/categorization-rules`, `/security`, `/auto-capture`, `/about`), so bookmarks, notification taps and in-page links still work. The Quick Tour's last step now points at the Settings entry and mentions Data.

### Domain Engine & Architecture

- **Hubs**: `Hub.folded` and `hubEntryPath` in [`hubs.ts`](../../src/lib/hubs.ts) are the single description of which screens belong together; the sidebar's folded entries are built from it (`hubEntry` in [`AppShell.tsx`](../../src/components/AppShell.tsx)), and [`HubTabs.tsx`](../../src/components/HubTabs.tsx) draws the strip.
- **Tests**: `openScreen` in [`tests/e2e/helpers.ts`](../../tests/e2e/helpers.ts) opens a screen through its entry and strip; [`sidebarNavigation.spec.ts`](../../tests/e2e/sidebarNavigation.spec.ts) covers the grouping.
- **No data or schema change.**

### Not done

- Planning and Wealth still list a link per screen. Budget vs. Actual (a report on Budgets) and Payoff Planner (a tool on Liabilities) would fold into their parents the same way; their end-to-end specs click those links directly, so that is a separate change.

---

## Feature 026: Versioned Releases & In-app Updates (Android)

### Overview

Every build from `master` used to be a zipped workflow artifact that had to be downloaded and shared to the phone by hand, and the version only changed when someone edited `package.json`. Now each push gets its own version, is published as a GitHub Release, and the Android app can find, download and install it from **About → App updates**.

### Key Capabilities

- **A version per commit**: the workflow names the build `MAJOR.MINOR.<commit count>` (`MAJOR.MINOR` from `package.json`, currently `0.1`), uses the commit count as the Android `versionCode`, and publishes `MyFin-vX.Y.Z.apk` as release `vX.Y.Z` with the commit subjects as notes. Nothing is committed back.
- **Check for updates**: a button on the About page (Android app only). It shows the newer version, its size and notes, or says you are up to date.
- **Download and install**: shows progress, then checks the file (size, GitHub's SHA-256, that it is MyFin, newer, and signed with the installed key) before opening Android's installer. The first time, Android sends you to allow MyFin to install unknown apps; it always asks you to confirm, and your data stays.
- **Nothing runs by itself**: no background checks and no telemetry. The request happens only when you press the button.

### Domain Engine & Architecture

- **Native plugin**: [`NativeAppUpdatePlugin.java`](../../android/app/src/main/java/io/github/akhlaquea01/myfin/update/NativeAppUpdatePlugin.java) does the network, download, verification and install hand-off. The decisions (version comparison, which file is the app, which hosts a download may touch) are in [`UpdateRules.java`](../../android/app/src/main/java/io/github/akhlaquea01/myfin/update/UpdateRules.java), covered by [`UpdateRulesTest.java`](../../android/app/src/test/java/io/github/akhlaquea01/myfin/update/UpdateRulesTest.java).
- **The network stays out of the web layer**: the Content-Security-Policy keeps `connect-src 'self'`, so script in the page still cannot send anything anywhere. The page cannot name an address either: the plugin asks one fixed repository, remembers the file it found, and downloads and installs only that. Redirects are followed by hand and only to GitHub's file hosts.
- **Web side**: [`nativeAppUpdate.ts`](../../src/lib/native/nativeAppUpdate.ts) wraps the plugin and maps its error codes to messages; [`appUpdateStore.ts`](../../src/lib/appUpdateStore.ts) is the state machine (kept at module level so a download survives leaving the page); [`AppUpdateCard.tsx`](../../src/components/AppUpdateCard.tsx) is the card, shown by [`AboutPage.tsx`](../../src/pages/AboutPage.tsx) only when the plugin exists.
- **CI**: [`build-apk.yml`](../../.github/workflows/build-apk.yml) computes the version, passes it to Vite (`APP_VERSION`, read in `vite.config.ts`) and Gradle, checks the built APK carries it, and a separate `release` job (the only one with `contents: write`) publishes it. Only the newest commit on `master` is published.
- **Tests**: [`appUpdateStore.test.ts`](../../tests/unit/appUpdateStore.test.ts), [`appUpdateCard.test.tsx`](../../tests/component/appUpdateCard.test.tsx) and [`aboutPageUpdates.test.tsx`](../../tests/component/aboutPageUpdates.test.tsx).
- **No data or schema change.**

### Needs a device check

- The plugin could not be compiled or run here (no Android SDK); only `UpdateRules.java` was compiled and its tests run with plain `javac`. The first CI run builds the plugin, and an install over an older build on a phone proves the download and the installer hand-off.
- The release job has never run: confirm a green **Publish GitHub Release** step and the `v0.1.N` release page after the first push.

### Not done

- No automatic or background check; it is a button on purpose. A once-a-day check on launch (opt-in) would be a small addition.
- Old releases are not pruned; delete them from the Releases page if the list grows.
