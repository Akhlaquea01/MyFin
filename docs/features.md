# MyFin — Feature Documentation

This document provides a comprehensive reference of all 18 core features built into the MyFin application, detailing user workflows, business logic, domain engines, data models, and UI surfaces.

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

---

## Feature 001: Core Personal Finance Manager & Encrypted Ledger

### Overview
The foundational layer of MyFin providing zero-knowledge, local-first personal financial management. All sensitive data (transactions, accounts, budgets, payees) is stored encrypted in browser IndexedDB.

### Key Capabilities
- **Accounts Management**: Support for multiple account types (`bank`, `credit`, `cash`, `investment`, `loan`, `wallet`).
- **Encrypted Double-Sided Ledger**: Immutable transaction history supporting income, expense, and account transfers.
- **Split Transactions**: Allocate a single transaction across multiple categories.
- **Hierarchical Categories**: Parent/child category tree, understood everywhere categories appear. A budget on a parent covers every subcategory below it (the card says "Includes N subcategories"; a child budget tracks only the child), and the Budget vs. Actual report neither lists a covered subcategory as "unbudgeted" nor counts it twice. Pickers, transaction lists, charts, notifications and exports label a subcategory with its full path ("Food › Groceries"), so two "Other" subcategories under different parents can be told apart, and children sit under their parent in pickers. Analytics can optionally group subcategories under their top-level parent. A parent with subcategories can't be deleted until they are gone, and a subcategory orphaned by an older deletion is shown at the top level instead of vanishing.
- **Quick Add**: Paste a bank/SMS message to get a proposed, reviewable transaction. Reads amounts written `Rs.500`, `INR 500`, `₹500`, `500 INR`, or with no currency at all when a verb introduces them (`debited by 500.00`, `Amount: 750`); never takes an account number, reference or digits glued to an account tag for the amount, and takes the transaction amount rather than a later balance. The account is picked from the digits the message names ("A/c XX1234", "XXXX-1234", "card ending 5678") when they match an account's saved digits; a message that looks like a duplicate of an existing entry (same account, same amount, within a day — including entries still in Review) is shown to you before saving; adding it anyway marks it as a possible duplicate in Review.
- **Account Transfers & Card Bill Payments**: One flow moves money between two of the user's own accounts as a single linked pair of transactions; the same screen, switched to "Card bill payment", pays a credit card (showing what is owed, with a one-tap "Pay full outstanding"). The New Transaction type picker, the card's own "Pay bill" button, and a recognised Quick Add message all lead there. Deleting, restoring or editing either leg acts on both, atomically.
- **Record as Transfer**: An entry that was imported or entered as an ordinary expense/income (typically a card payment) can be converted to a transfer from the Review Queue or the Edit dialog — linking to the matching entry already on the other account (found by amount and date) or creating the missing leg — so it stops counting as spending/income and both balances agree.
- **Edit Transactions**: Every transaction can be edited in place (account, type, amount, date, category, merchant, tags, notes). A transfer is edited as one movement; the ledger entry behind a person loan is read-only and managed from People.
- **Liabilities & Net Worth**: Manual liability tracking (loans, credit card debt) alongside a computed net worth figure spanning accounts, liabilities, investments, and person loans, with historical snapshots. A liability's balance, EMI, due day, rate and minimum payment can be edited, and **Record payment** pays it from a bank/cash/wallet account in one step — the money leaves the account and the amount owed drops by the same amount (net worth is unchanged). The ledger entry is linked to the payment, so it can only be reversed with **Undo** on the Liabilities page, not edited or deleted on its own. A card already tracked as an account is paid with "Pay bill" instead.
- **PIN & Biometric Authentication**: Onboarding PIN entry with PBKDF2 key derivation and biometric unlock — WebAuthn in the browser, Android's fingerprint prompt in the APK (see Feature 020). The PIN can be changed from **Security** (the whole database is re-encrypted under the new PIN in one transaction) and, if forgotten, the lock screen's **Forgot your PIN?** is the one way out: it erases the device after a typed confirmation, so a backup can be restored under its own PIN (see Feature 021).
- **CSV / Excel Export**: One row per transaction with `date, account, categories, amount, notes` (the original columns, unchanged and first) followed by `type` (income / expense / transfer), `merchant`, `tags`, `status` (confirmed / unreviewed) and `counterpart` (the account on the other side of a transfer). A transfer is therefore identifiable as one — and has no category — instead of looking like an uncategorized expense plus an uncategorized income. Subcategories are exported by full path; text columns are protected against spreadsheet-formula injection.
- **Encrypted Backup & Restore**: AES-GCM encrypted single-file backup export with SHA-256 HMAC integrity verification.
- **Soft-Delete & Trash Recovery**: 30-day soft-delete lifecycle for transactions, accounts, savings goals, categorization rules, people, and person loans, with a unified Trash page for restore or permanent purge.

### Domain Engine & Architecture
- **Engine**: [`src/domain/transactions/transactionEngine.ts`](file:///e:/MyFin/src/domain/transactions/transactionEngine.ts), [`src/domain/wealth/wealthEngine.ts`](file:///e:/MyFin/src/domain/wealth/wealthEngine.ts) (net worth/liabilities)
- **Repositories**: [`accountRepository.ts`](file:///e:/MyFin/src/data/dexie/accountRepository.ts), [`transactionRepository.ts`](file:///e:/MyFin/src/data/dexie/transactionRepository.ts), [`categoryRepository.ts`](file:///e:/MyFin/src/data/dexie/categoryRepository.ts), [`wealthRepository.ts`](file:///e:/MyFin/src/data/dexie/wealthRepository.ts)
- **Primary Pages**: [`DashboardPage.tsx`](file:///e:/MyFin/src/pages/DashboardPage.tsx), [`AccountsPage.tsx`](file:///e:/MyFin/src/pages/AccountsPage.tsx), [`TransactionsPage.tsx`](file:///e:/MyFin/src/pages/TransactionsPage.tsx), [`NewTransactionPage.tsx`](file:///e:/MyFin/src/pages/NewTransactionPage.tsx), [`CategoriesPage.tsx`](file:///e:/MyFin/src/pages/CategoriesPage.tsx), [`TransferPage.tsx`](file:///e:/MyFin/src/pages/TransferPage.tsx), [`LiabilitiesPage.tsx`](file:///e:/MyFin/src/pages/LiabilitiesPage.tsx), [`NetWorthPage.tsx`](file:///e:/MyFin/src/pages/NetWorthPage.tsx), [`TrashPage.tsx`](file:///e:/MyFin/src/pages/TrashPage.tsx)

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
- **Engine**: [`src/domain/debtPlanner/generatePlan.ts`](file:///e:/MyFin/src/domain/debtPlanner/generatePlan.ts)
- **Repository**: [`debtPlannerPreferenceRepository.ts`](file:///e:/MyFin/src/data/dexie/debtPlannerPreferenceRepository.ts)
- **Primary Page**: [`DebtPayoffPlannerPage.tsx`](file:///e:/MyFin/src/pages/DebtPayoffPlannerPage.tsx)

---

## Feature 003: Savings Goals Tracker

### Overview
Visual goal tracking that connects target savings amounts with dedicated or pooled financial accounts, displaying progress, target timelines, and forecast indicators.

### Key Capabilities
- **Target Tracking**: Set goal target amount, currency, target completion date, and priority.
- **Funding Models**:
  - Direct account balance linking.
  - Manual contribution logging with historical milestone tracking.
- **Progress Projection**: Real-time pace calculation (on track, behind schedule, ahead of schedule) based on average monthly savings rate.
- **Soft Delete & Archive**: Ability to mark goals achieved, archived, or soft-deleted into Trash.

### Domain Engine & Architecture
- **Engine**: [`src/domain/savingsGoals/goalProgress.ts`](file:///e:/MyFin/src/domain/savingsGoals/goalProgress.ts)
- **Repository**: [`savingsGoalRepository.ts`](file:///e:/MyFin/src/data/dexie/savingsGoalRepository.ts)
- **Primary Page**: [`SavingsGoalsPage.tsx`](file:///e:/MyFin/src/pages/SavingsGoalsPage.tsx)

---

## Feature 004: Recurring Budget Notifications

### Overview
Predictive bill calendar, recurring payment automation, and proactive budget threshold notification checks.

### Key Capabilities
- **Recurring Cadences**: Weekly (a weekday, 0 = Sunday), monthly (a day of the month) and yearly (a day of the year) rules. The day field is described in those terms everywhere it is asked, including "Mark as recurring" in Review, which starts from the transaction's own date.
- **Expected Events Generation**: Projects future transaction occurrences with status tracking (`pending`, `matched`, `missed`).
- **Payment Matching**: A recorded transaction on the rule's account, for the same amount and direction within ±3 days of an expected event, marks it `matched`. An *uncategorized* entry matches regardless of the rule's category (bills usually arrive from a statement or SMS before they are categorized); an entry with a different real category does not. A `missed` event is matched if the bill is recorded late. Matches are re-evaluated when an entry is confirmed, edited or restored, and released when it is deleted or turned into a transfer. Transfers never match.
- **Budget Threshold Alerts**: Configurable alerts when category spend exceeds 80%, 90%, or 100% of budgeted envelope.
- **In-App Alerts**: Due bills, budget thresholds and overdue loans are checked each time MyFin is unlocked. Each new one is shown as a system notification (a browser notification, or a real Android one in the APK) **and** kept in the in-app **Alerts** list — whatever the notification permission is, so a reminder the system could not show is still there. Alerts have an unread badge in the menu, open the matching screen (Upcoming, Budgets, People) when tapped, and can be dismissed, marked read or cleared (the last asks first). One entry per occurrence; the newest 100 are kept. Tapping an Android notification opens the same screen. Because the check runs on unlock, a reminder cannot appear while the app is closed — the Notifications page says so, and shows whether the device currently allows notifications at all.
- **Local notifications only**: No server and no push service; nothing about the user's money is handed to the OS scheduler. The one scheduled notification is the fixed-text weekly backup reminder (Feature 021).
- **Notification Settings**: User-configurable master enable/disable, reminder lead days, and budget threshold percentage.

### Domain Engine & Architecture
- **Engines**: [`src/domain/recurring/recurringEngine.ts`](file:///e:/MyFin/src/domain/recurring/recurringEngine.ts), [`src/domain/notifications/notificationEngine.ts`](file:///e:/MyFin/src/domain/notifications/notificationEngine.ts)
- **Repositories**: [`recurringRepository.ts`](file:///e:/MyFin/src/data/dexie/recurringRepository.ts), [`notificationRepository.ts`](file:///e:/MyFin/src/data/dexie/notificationRepository.ts)
- **Primary Pages**: [`RecurringPage.tsx`](file:///e:/MyFin/src/pages/RecurringPage.tsx), [`RecurringUpcomingPage.tsx`](file:///e:/MyFin/src/pages/RecurringUpcomingPage.tsx), [`BudgetsPage.tsx`](file:///e:/MyFin/src/pages/BudgetsPage.tsx), [`NotificationSettingsPage.tsx`](file:///e:/MyFin/src/pages/NotificationSettingsPage.tsx)

---

## Feature 005: Encrypted Receipt Attachments

### Overview
Client-side encrypted image and document attachment system allowing users to store receipts, invoices, and payment confirmations alongside transactions.

### Key Capabilities
- **Client-Side Compression**: High-quality canvas-based downscaling (max 1600px dimension, JPEG/WebP compression) before encryption to conserve storage.
- **Multi-Attachment**: Up to 5 attachments per transaction.
- **Zero-Knowledge Encryption**: Image binary data is AES-256-GCM encrypted before being stored in IndexedDB.
- **Secure Image Viewer**: Lightbox modal with zoom, pan, rotation, and export capabilities.
- **Automatic Cascading Deletion**: Hard deletion or soft deletion of parent transaction appropriately cascades to associated attachments.

### Domain Engine & Architecture
- **Helpers**: [`src/lib/imageAttachment.ts`](file:///e:/MyFin/src/lib/imageAttachment.ts)
- **Repository**: [`attachmentRepository.ts`](file:///e:/MyFin/src/data/dexie/attachmentRepository.ts)
- **Component**: Embedded in [`TransactionsPage.tsx`](file:///e:/MyFin/src/pages/TransactionsPage.tsx) and transaction edit sheets.

---

## Feature 006: Auto-Categorization & Merchant Learning

### Overview
Automated transaction categorization engine combining explicit user-defined matching rules with continuous merchant streak learning.

### Key Capabilities
- **Merchant & Alias Rules**: A rule maps a merchant (or one specific alias of it) to a category and tags. At most one live rule exists per merchant + scope.
- **Keyword Rules ("description contains")**: A rule can instead match *text*: any transaction whose description or merchant name has a word starting with the keyword — case- and punctuation-insensitive, so `swiggy` files `UPI-SWIGGY-88123`, `SWIGGY INSTAMART` and `Swiggy One` alike, which per-merchant rules cannot (each distinct description is its own merchant). Needs at least 3 letters/digits; the same keyword can't be added twice however it is written. The rule dialog previews which uncategorized transactions the keyword would catch before it is saved. Works on manual entry, Quick Add, file and bulk imports, including rows with no merchant at all. There is no regex matching.
- **Precedence**: exact-alias rule → merchant rule → keyword rule (the longest matching keyword wins; an exact tie goes to the older rule) → learned suggestion. A category you chose yourself is never overridden.
- **Merchant Normalization**: Strips reference numbers, dates and rail codes (UPI/NEFT/IMPS…) from imported descriptions so repeat sightings converge on one merchant. Manual entry now reuses an existing merchant by name instead of creating a new one every time.
- **Streak Learning Engine**: When a user confirms the same category for a merchant 3 times in a row — in the Review Queue, or by choosing the category by hand on a new entry — the engine surfaces a suggestion. A merchant that already has a rule — or whose name a keyword rule already matches — is never offered a suggestion.
- **Retroactive Apply**: Creating or promoting a rule (merchant or keyword) offers to file the existing, still-uncategorized transactions it matches; the Review Queue has "Apply rules to queue"; and a rule can be applied later from its row. An entry that already has a category is never overridden.
- **Visible Provenance**: The Review Queue marks a pre-filled category as "Auto: rule" or "Suggested", and New Transaction previews what the typed merchant will be filed under.

### Domain Engine & Architecture
- **Engine**: [`src/domain/categorization/categorizationEngine.ts`](file:///e:/MyFin/src/domain/categorization/categorizationEngine.ts), [`keywordMatching.ts`](file:///e:/MyFin/src/domain/categorization/keywordMatching.ts), [`resolveCategorization.ts`](file:///e:/MyFin/src/domain/categorization/resolveCategorization.ts), [`src/domain/parser/merchantResolver.ts`](file:///e:/MyFin/src/domain/parser/merchantResolver.ts)
- **Repositories**: [`categorizationRuleRepository.ts`](file:///e:/MyFin/src/data/dexie/categorizationRuleRepository.ts), [`merchantCategorySignalRepository.ts`](file:///e:/MyFin/src/data/dexie/merchantCategorySignalRepository.ts)
- **Primary Page**: [`CategorizationRulesPage.tsx`](file:///e:/MyFin/src/pages/CategorizationRulesPage.tsx)

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
- **Engine**: [`src/domain/analytics/financialHealthEngine.ts`](file:///e:/MyFin/src/domain/analytics/financialHealthEngine.ts)
- **Service**: [`financialHealthService.ts`](file:///e:/MyFin/src/domain/analytics/financialHealthService.ts)
- **Primary Page**: [`FinancialHealthPage.tsx`](file:///e:/MyFin/src/pages/FinancialHealthPage.tsx)

---

## Feature 008: PWA Web Share Target

### Overview
Native OS integration enabling users on Android, Windows, and macOS to share receipts, bank SMS text, and transaction confirmation URLs directly into MyFin.

### Key Capabilities
- **Service Worker Share Handler**: Registered via `public/sw-share-target.js` to process incoming POST multipart share actions.
- **Quick-Add Text Parsing**: Rule-based parser extracting amount, direction, merchant and — when the message states one — the date (day-first: `12/10/2026`, `12-Oct-26`, `2026-10-12`) from shared SMS/text snippets, e.g. "Rs.500 debited from A/c XX1234 to AMAZON on 12/10/2026". Amounts are read in rupees (`Rs`, `INR`, `₹`, or a bare number after a verb such as "debited"); other currencies are not recognised. A message without a date is dated today. Parsing a new message replaces every field, so nothing from the previous message lingers.
- **Direct Receipt Ingestion**: Automatically attaches shared photos/screenshots to a new transaction draft.

### Domain Engine & Architecture
- **Service Worker**: [`public/sw-share-target.js`](file:///e:/MyFin/public/sw-share-target.js)
- **Parser**: [`src/domain/parser/quickAddParser.ts`](file:///e:/MyFin/src/domain/parser/quickAddParser.ts)
- **Primary Page**: [`ShareTargetLandingPage.tsx`](file:///e:/MyFin/src/pages/ShareTargetLandingPage.tsx), [`QuickAddPage.tsx`](file:///e:/MyFin/src/pages/QuickAddPage.tsx)

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
- **Engine**: [`src/data/io/importService.ts`](file:///e:/MyFin/src/data/io/importService.ts), [`src/data/io/bulkTextImportService.ts`](file:///e:/MyFin/src/data/io/bulkTextImportService.ts)
- **Primary Pages**: [`ImportPage.tsx`](file:///e:/MyFin/src/pages/ImportPage.tsx), [`ReviewPage.tsx`](file:///e:/MyFin/src/pages/ReviewPage.tsx), [`BulkTextImportPage.tsx`](file:///e:/MyFin/src/pages/BulkTextImportPage.tsx)

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
- **Edit & Remove**: A loan's due date and notes can be edited; a mis-recorded loan can be removed (with its repayments and ledger movements, restoring the account balance) and recovered from Trash.

### Domain Engine & Architecture
- **Engine**: [`src/domain/personLoans/loanProgress.ts`](file:///e:/MyFin/src/domain/personLoans/loanProgress.ts)
- **Repository**: [`personLoanRepository.ts`](file:///e:/MyFin/src/data/dexie/personLoanRepository.ts)
- **Primary Page**: [`PeoplePage.tsx`](file:///e:/MyFin/src/pages/PeoplePage.tsx)

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
- **Engines**: [`src/domain/reports/reportEngine.ts`](file:///e:/MyFin/src/domain/reports/reportEngine.ts), [`src/domain/reports/reportService.ts`](file:///e:/MyFin/src/domain/reports/reportService.ts)
- **PDF Generator**: [`src/data/io/reportPdfExport.ts`](file:///e:/MyFin/src/data/io/reportPdfExport.ts)
- **Primary Page**: [`AnalyticsPage.tsx`](file:///e:/MyFin/src/pages/AnalyticsPage.tsx)

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
- **Engine**: [`src/domain/transactions/tagFilterEngine.ts`](file:///e:/MyFin/src/domain/transactions/tagFilterEngine.ts)
- **Repository**: [`tagRepository.ts`](file:///e:/MyFin/src/data/dexie/tagRepository.ts)
- **Primary Page**: Integrated into [`TransactionsPage.tsx`](file:///e:/MyFin/src/pages/TransactionsPage.tsx)

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
- **Repository**: [`savedFilterViewRepository.ts`](file:///e:/MyFin/src/data/dexie/savedFilterViewRepository.ts)
- **Primary Page**: [`TransactionsPage.tsx`](file:///e:/MyFin/src/pages/TransactionsPage.tsx)

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
- **Components**: [`QuickTourProvider.tsx`](file:///e:/MyFin/src/components/ui/quick-tour/QuickTourProvider.tsx), [`QuickTourOverlay.tsx`](file:///e:/MyFin/src/components/ui/quick-tour/QuickTourOverlay.tsx)
- **Step Config**: [`src/components/ui/quick-tour/tour-steps.ts`](file:///e:/MyFin/src/components/ui/quick-tour/tour-steps.ts)
- **Hook**: [`useQuickTour.ts`](file:///e:/MyFin/src/hooks/useQuickTour.ts)

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
- **Service**: [`src/data/io/templateService.ts`](file:///e:/MyFin/src/data/io/templateService.ts)
- **Types**: [`src/data/io/templateTypes.ts`](file:///e:/MyFin/src/data/io/templateTypes.ts)
- **Starter Sample**: [`src/data/io/sampleTemplate.ts`](file:///e:/MyFin/src/data/io/sampleTemplate.ts)
- **Primary Pages**: [`ExportPage.tsx`](file:///e:/MyFin/src/pages/ExportPage.tsx), [`BackupSettingsPage.tsx`](file:///e:/MyFin/src/pages/BackupSettingsPage.tsx)

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
- **Engines**: [`budgetEngine.ts`](file:///e:/MyFin/src/domain/budgets/budgetEngine.ts) (`ensureBudgetItemForPeriod`), [`recurringEngine.ts`](file:///e:/MyFin/src/domain/recurring/recurringEngine.ts) (`createRuleFromTransaction`), [`wealthEngine.ts`](file:///e:/MyFin/src/domain/wealth/wealthEngine.ts) (`recordPurchase`/`recordSale`)
- **Data Layer**: [`clearAllTables.ts`](file:///e:/MyFin/src/data/dexie/clearAllTables.ts), [`resetService.ts`](file:///e:/MyFin/src/data/io/resetService.ts), import-time budget recompute and investment type mapping in [`templateService.ts`](file:///e:/MyFin/src/data/io/templateService.ts)
- **Primary Pages**: [`DashboardPage.tsx`](file:///e:/MyFin/src/pages/DashboardPage.tsx), [`TransactionsPage.tsx`](file:///e:/MyFin/src/pages/TransactionsPage.tsx), [`ReviewPage.tsx`](file:///e:/MyFin/src/pages/ReviewPage.tsx), [`AccountsPage.tsx`](file:///e:/MyFin/src/pages/AccountsPage.tsx), [`BudgetsPage.tsx`](file:///e:/MyFin/src/pages/BudgetsPage.tsx), [`BackupSettingsPage.tsx`](file:///e:/MyFin/src/pages/BackupSettingsPage.tsx), [`InvestmentsPage.tsx`](file:///e:/MyFin/src/pages/InvestmentsPage.tsx)

---

## Feature 017: Financial Visibility & Control Enhancements

### Overview
A bundle of five visibility and control gaps closed across credit cards, net worth, budgets, investments, and imports: credit limit/utilization tracking, a categorized net worth breakdown with duplicate-debt detection, budget editing with historical-period protection, portfolio-level investment aggregates, and identifier-based auto-matching of imported/pasted credit card transactions to the right account.

### Key Capabilities
- **Credit Card Limit & Utilization**: Credit card accounts gain an optional credit limit and billing cycle day. Wherever a card's balance is shown, the app displays amount used, amount available, and a utilization percentage; cards at ≥90% utilization or over their limit are visually flagged. A temporarily positive balance (overpayment/refund) clamps to ₹0 used / 100% available rather than showing negative usage. Cards with no limit set still show amount used, with a prompt to add a limit.
- **Categorized Net Worth Breakdown**: Net worth is broken into labeled, drillable subtotals — cash/bank balances, credit card debt, investment value, loans lent, loans borrowed, and other liabilities — that sum exactly to the displayed total, instead of one opaque figure. A transaction-linked credit card account is the single source of truth for its debt.
- **Duplicate Credit Card Debt Detection**: When a manually-entered liability looks like it represents the same real card as an existing transaction-linked account (by name, nickname, or last-4 match), the user is warned and can either link the liability to the account (so only the account counts toward net worth) or dismiss the warning to keep both counted independently.
- **Budget Edit & Soft-Delete with Undo**: Existing budgets can be edited (amount, category, period type, rollover) and removed with a confirmation step and short undo window. Edits apply to the current and future periods only — already-closed historical periods keep the figures that were actually budgeted at the time (fixes a latent bug where browsing budget history after an edit could silently rewrite a closed period's planned amount). Two active budgets for the same category/period are prevented.
- **Automatic Net Worth History**: Net worth history builds itself — the first time the app is unlocked each day (or Net Worth is opened) records that day's point, once, never overwriting one already taken, and recording nothing for an empty ledger. "Record snapshot" refreshes today's point instead of adding a duplicate.
- **Investment Portfolio Aggregates**: The Investments view shows total current value, total invested (cost basis), and total gain/loss (currency and percentage) across all holdings, broken down further by investment type. Holdings without a recorded valuation fall back to cost basis and are visually marked as an estimate.
- **Trades Through an Account**: "Buy more units" can take the cost out of a bank, cash or wallet account, and "Sell units" can add the proceeds to one (with a sale price), in the same step — the account's side is posted as a transfer-type ledger entry (not spending, not income, so budgets and reports are unaffected) tied to the holding, so it can't be edited or deleted on its own. With no account chosen, only the holding changes. The holding's Edit dialog lists its purchases and sales, and the latest can be undone: units, average price, cost basis, the recorded value it adjusted and the account entry all go back. Editing a holding's units or price outright clears that list (the entries stay as ordinary ledger entries).
- **Goal Contributions Are Tracking Only**: Logging a savings-goal contribution says so (it does not move money or change a balance) and links to Transfer for moving the money itself — a goal is not part of net worth, so debiting an account for it would have made net worth fall.
- **Value Follows Units**: Buying or selling units moves a holding's recorded value with them — a purchase adds what it cost (so the money put in is not reported as a loss), a sale scales the value to the units that remain, and selling everything takes it to nothing — instead of leaving the old value counting toward net worth. A holding with no recorded value is valued at its cost basis, which already follows its units.
- **Trash for Wealth Records**: Deleted investment holdings, liabilities and budgets are listed in Trash (alongside accounts, transactions, goals, rules and loans) and can be restored after the Undo toast has gone. A budget is not restored over a newer one for the same category.
- **Edit and Delete Holdings**: A holding can be corrected after it is added — name, type, and the units and average price it was entered with (its cost basis follows; a legacy unit-less holding edits its cost basis directly). Delete takes it out of the portfolio and net worth with an Undo toast. "Update value" starts from the current value, entering a value again the same day replaces that day's value (it used to leave two with no defined winner), and the Edit dialog lists the recorded values so a wrong one can be deleted. Cost basis is kept a whole number of minor units after buying or selling fractional units.
- **Credit Card Identifier Matching for Imports**: Credit card accounts can be tagged with a last-4-digit identifier and/or a nickname. Both the CSV/XLSX importer and the paste-based bulk text importer scan incoming content for a tagged identifier and pre-select the matching card as the destination, showing which identifier matched and why; an ambiguous match (multiple cards) prompts the user to disambiguate, and an unmatched import falls back to manual account selection without being blocked. A single file can route different rows to different matched cards.

### Domain Engine & Architecture
- **Engine**: [`src/domain/wealth/wealthEngine.ts`](file:///e:/MyFin/src/domain/wealth/wealthEngine.ts) (`computeCardUtilization`, `computeNetWorth`, `findLikelyDuplicateAccounts`, `linkLiabilityToAccount`, `dismissDuplicateWarning`, `computePortfolioSummary`)
- **Matcher**: [`src/domain/parser/cardIdentifierMatcher.ts`](file:///e:/MyFin/src/domain/parser/cardIdentifierMatcher.ts) (`findCardMatches`)
- **Budget Engine**: [`src/domain/budgets/budgetEngine.ts`](file:///e:/MyFin/src/domain/budgets/budgetEngine.ts)
- **Repositories**: [`wealthRepository.ts`](file:///e:/MyFin/src/data/dexie/wealthRepository.ts), [`budgetRepository.ts`](file:///e:/MyFin/src/data/dexie/budgetRepository.ts) (`softDelete`/`restore`), [`accountRepository.ts`](file:///e:/MyFin/src/data/dexie/accountRepository.ts) (`creditLimit`, `billingCycleDay`, `cardLast4`, `cardNickname`)
- **Import Integration**: [`importService.ts`](file:///e:/MyFin/src/data/io/importService.ts), [`bulkTextImportService.ts`](file:///e:/MyFin/src/data/io/bulkTextImportService.ts)
- **Primary Pages**: [`AccountsPage.tsx`](file:///e:/MyFin/src/pages/AccountsPage.tsx), [`LiabilitiesPage.tsx`](file:///e:/MyFin/src/pages/LiabilitiesPage.tsx), [`NetWorthPage.tsx`](file:///e:/MyFin/src/pages/NetWorthPage.tsx), [`BudgetsPage.tsx`](file:///e:/MyFin/src/pages/BudgetsPage.tsx), [`InvestmentsPage.tsx`](file:///e:/MyFin/src/pages/InvestmentsPage.tsx), [`ImportPage.tsx`](file:///e:/MyFin/src/pages/ImportPage.tsx), [`BulkTextImportPage.tsx`](file:///e:/MyFin/src/pages/BulkTextImportPage.tsx)

---

## Feature 018: Financial Planning & Productivity Enhancements

### Overview
Seven independently-shippable additions spanning passive insight (subscriptions, forecasting), budgeting depth (variance reporting, envelope rollover), and everyday usability (quick search, a customizable dashboard, unattended local backups) — each reusing an existing domain engine as its foundation rather than introducing a parallel one.

### Key Capabilities
- **Subscription Tracker**: Detects merchants with a repeating amount/interval charge pattern directly from existing transaction history — no manual recurring-rule setup. Groups charges by merchant (or normalized description text when no merchant is resolved), classifies a cadence (weekly/monthly/quarterly/yearly) within a tolerance window, and flags a subscription as possibly lapsed once it's overdue for its own cadence. Shows total detected monthly cost, and a merchant can be dismissed from the view without touching its transactions. Credit card bill payments (recognised by description or merchant name) are never reported as subscriptions.
- **Cash-Flow Forecasting**: Projects an account's balance 30/60/90 days out by combining its scheduled recurring transactions (deterministic) with a trailing-average "drift" term for ordinary non-recurring spend, and warns in advance of the first date a configurable low-balance threshold would be crossed. For a **credit card** the projection is its amount owed — the trend includes the card's bill payments — and the warning is against its credit limit (none if no limit is set) rather than a low-balance threshold. Marks a forecast low-confidence rather than fabricating a projection when an account has too little recurring/historical signal.
- **Budget vs. Actual Variance Report**: A dedicated month-range report distinct from the general Analytics page, showing budgeted, actual, and variance per category with over/under/on-track/unbudgeted status — a category with real spend but no budget is never silently folded into zero-variance, and a budgeted category with zero spend is never omitted.
- **Envelope Rollover Budgeting**: Extends the existing (positive-only) budget rollover with an opt-in "full" mode that also carries an overspend deficit into the next period, alongside the original "roll over surplus only" behavior and the default "off." The rolled-over amount (positive or negative) is always shown as a line distinct from the period's base budget, and disabling rollover on a category with an accumulated balance requires an explicit confirmation explaining what happens to it.
- **Global Command Palette**: A Ctrl+K/Cmd+K keyboard-accessible overlay searching transactions, payees, and accounts, built on an in-memory index (Dexie's encrypted-field indexes are exact-match only, so ciphertext can't be substring-searched) that's rebuilt on every palette open and exists only inside the authenticated app shell — structurally unreachable while the app is locked.
- **Customizable Dashboard Widgets**: The Dashboard's cards are config-driven instead of fixed — users can hide, show, and reorder widgets from a settings sheet, with the layout persisted across sessions. At least one core widget always stays visible, and an unrecognized or missing widget id in a stored layout is handled gracefully rather than breaking the page.
- **Scheduled Local Encrypted Backups**: An optional automatic backup to a folder on the same device (via the File System Access API), reusing the existing manual export's encryption path unchanged. Because the backup encryption key is derived from the plaintext PIN — which is never stored — an automatic backup can only run at the moment of a successful PIN unlock, not on a background timer; this is surfaced honestly via a last-successful-backup timestamp rather than implying a stronger guarantee. Gracefully explains when a browser doesn't support the underlying API.

### Domain Engine & Architecture
- **Engines**: [`subscriptionDetectionEngine.ts`](file:///e:/MyFin/src/domain/recurring/subscriptionDetectionEngine.ts) (`detectSubscriptions`), [`forecastEngine.ts`](file:///e:/MyFin/src/domain/forecast/forecastEngine.ts) (`projectAccountBalance`), [`budgetVarianceEngine.ts`](file:///e:/MyFin/src/domain/budgets/budgetVarianceEngine.ts) (`computeVarianceReport`), [`budgetEngine.ts`](file:///e:/MyFin/src/domain/budgets/budgetEngine.ts) (extended with `rolloverMode`'s deficit-carry), [`searchIndex.ts`](file:///e:/MyFin/src/domain/search/searchIndex.ts) (`buildSearchIndex`/`querySearchIndex`), [`dashboardLayout.ts`](file:///e:/MyFin/src/domain/analytics/dashboardLayout.ts) (`resolveDashboardLayout`)
- **Data Layer**: [`autoBackupSettingsRepository.ts`](file:///e:/MyFin/src/data/dexie/autoBackupSettingsRepository.ts), [`autoBackupService.ts`](file:///e:/MyFin/src/data/io/autoBackupService.ts) (`maybeRunScheduledBackup`, reusing `backupService.ts`'s `createBackup` unchanged), Dexie schema v12 (`autoBackupSettings` table)
- **Primary Pages**: [`SubscriptionsPage.tsx`](file:///e:/MyFin/src/pages/SubscriptionsPage.tsx), [`CashFlowForecastPage.tsx`](file:///e:/MyFin/src/pages/CashFlowForecastPage.tsx), [`BudgetVarianceReportPage.tsx`](file:///e:/MyFin/src/pages/BudgetVarianceReportPage.tsx), [`BudgetsPage.tsx`](file:///e:/MyFin/src/pages/BudgetsPage.tsx), [`DashboardPage.tsx`](file:///e:/MyFin/src/pages/DashboardPage.tsx), [`BackupSettingsPage.tsx`](file:///e:/MyFin/src/pages/BackupSettingsPage.tsx)
- **Components**: [`CommandPalette.tsx`](file:///e:/MyFin/src/components/CommandPalette.tsx), [`DashboardCustomizeSheet.tsx`](file:///e:/MyFin/src/components/DashboardCustomizeSheet.tsx)

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
- **Biometric**: [`src/lib/biometric.ts`](file:///e:/MyFin/src/lib/biometric.ts) (provider choice, reasons), [`src/lib/native/nativeBiometric.ts`](file:///e:/MyFin/src/lib/native/nativeBiometric.ts), [`src/lib/pinWrap.ts`](file:///e:/MyFin/src/lib/pinWrap.ts), native `NativeBiometricPlugin.java` / `BiometricVault.java`
- **Session**: [`SessionContext.tsx`](file:///e:/MyFin/src/context/SessionContext.tsx) (`lockIfExpired`, `setAutoLockTimeout`), [`appState.ts`](file:///e:/MyFin/src/lib/native/appState.ts), [`useAppActive.ts`](file:///e:/MyFin/src/hooks/useAppActive.ts)
- **Capture domain**: [`src/domain/capture/`](file:///e:/MyFin/src/domain/capture/) (`captureFilter`, `captureParser`, `accountMatcher`, `capturePairing`, `originalMessage`)
- **Capture data layer**: [`captureIngestService.ts`](file:///e:/MyFin/src/data/io/captureIngestService.ts), [`captureDrain.ts`](file:///e:/MyFin/src/data/io/captureDrain.ts), [`captureSetup.ts`](file:///e:/MyFin/src/data/io/captureSetup.ts), [`sealedBox.ts`](file:///e:/MyFin/src/data/crypto/sealedBox.ts)
- **Native capture**: `android/app/src/main/java/io/github/akhlaquea01/myfin/capture/` (`SmsReceiver`, `NotificationCaptureService`, `SealedBox`, `CaptureFilter`, `CaptureQueue`, `CaptureNotifier`, `TransactionCapturePlugin`)
- **Pages**: [`SecurityPage.tsx`](file:///e:/MyFin/src/pages/SecurityPage.tsx), [`AutoCapturePage.tsx`](file:///e:/MyFin/src/pages/AutoCapturePage.tsx), [`ReviewPage.tsx`](file:///e:/MyFin/src/pages/ReviewPage.tsx), [`AccountsPage.tsx`](file:///e:/MyFin/src/pages/AccountsPage.tsx) (account digits)

---

## Feature 021: QA Hardening — Recovery, Durability & Everyday Flow

### Overview
A pass over the app's flows (onboarding, lock, entry, Review, backup, notifications, auto-capture) that closed gaps where a user could lose data, lose access, or be left on a dead end. The larger items are listed first.

### Key Capabilities
- **Change PIN and Forgot PIN**: **Security → Change PIN** verifies the current PIN (counted toward the same lockout as the lock screen), then re-encrypts every row, the captured-message sealing key and the profile under the new PIN in a single transaction; a failure leaves the old PIN and data untouched. Fingerprint unlock turns off (it wrapped the old PIN) and the session is locked. The lock screen's **Forgot your PIN?** explains that nothing can recover the PIN and offers an erase-and-start-over behind a typed `DELETE EVERYTHING`.
- **Backup durability**: A backup is opened and verified with its PIN before it is handed to the share sheet. The Backup page shows how long ago the last backup was, and on Android says plainly that uninstalling, clearing storage or changing phones erases the data. **Remind me weekly** schedules a fixed-text Android notification (no amounts or merchants) and shows a Dashboard banner whenever the last backup is a week old or missing. Restore warns that the PIN, fingerprint and auto-lock settings revert to the backup's, and refuses files too large to be a backup.
- **Lock when I leave the app**: An opt-in switch under Security → Auto-lock locks the app after 30 seconds out of the foreground (long enough for permission prompts and file pickers), regardless of the inactivity timer.
- **New Transaction**: A category chosen without an amount takes the whole total instead of being dropped; split totals that do not add up are explained in rupees ("500.00 still to allocate"); tags or a shared photo failing after the transaction saved are reported as "saved, but…" and the page moves on, so a retry cannot create a duplicate. The amount starts empty, there is a Cancel button, and a shared photo can be removed.
- **Review**: Confirm and Discard are guarded against double taps and report failures; reloads after applying a rule, undoing a discard or confirming in bulk no longer wipe categories and tags typed on other cards; **Confirm all categorized** leaves flagged entries (possible duplicates, captures filed on a guessed account) for a human look and says how many it left. An empty queue points to Quick Add, Import and Auto-capture.
- **First run**: The Dashboard shows a **Get started** card until there is an account, with a one-click **Add common categories** (idempotent, matched by name). The biometric offer is snoozed for 30 days when declined, and the tour, biometric offer and notification offer appear one at a time rather than together.
- **Navigation**: Grouped menu; on phones a bottom bar (Home, Activity, +, Check, More) with an Add menu (new transaction, paste a bank message, transfer). The Dashboard's Unreviewed card opens Review; Total Balance opens Accounts; Recent Transactions has View all. Unknown addresses show a Not-found page. On Android the Back button closes an open dialog or drawer first, then goes back, then leaves the app from the Dashboard.
- **Notifications**: Tapping an Android notification opens the matching screen. The Notifications page validates its fields inline and shows whether the device allows notifications, with an Allow button or a way to the system settings.
- **Auto-capture**: A banner appears anywhere in the app when capture is on but Android no longer allows it (SMS permission revoked, notification access off). The page explains why waiting messages are not being filed, offers **File them now**, links to Accounts when there is no account to file under, and lets the discarded/overflow notices be cleared. A message that passed the "looks like a transaction" filter but could not be parsed is no longer thrown away: its text is kept (encrypted, newest 100) under **Messages MyFin could not read**, where it can be opened in Quick Add to add by hand, or dismissed.
- **Confirmations**: Every "are you sure?" is one styled in-app dialog whose button names the action ("Move to trash", "Delete permanently", "Write off") — red when it cannot be undone — instead of the browser's native confirm box. Reversible deletes also offer a 10-second Undo.
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
- **PIN**: [`changePinService.ts`](file:///e:/MyFin/src/data/io/changePinService.ts), [`pinGate.ts`](file:///e:/MyFin/src/data/auth/pinGate.ts), [`resetService.ts`](file:///e:/MyFin/src/data/io/resetService.ts) (`resetEverything`), [`SessionContext.tsx`](file:///e:/MyFin/src/context/SessionContext.tsx) (`handleAppActiveChange`)
- **Backups**: [`backupReminder.ts`](file:///e:/MyFin/src/lib/backupReminder.ts), [`backupReminderService.ts`](file:///e:/MyFin/src/data/io/backupReminderService.ts), [`BackupNudgeBanner.tsx`](file:///e:/MyFin/src/components/BackupNudgeBanner.tsx)
- **Entry**: [`splitInput.ts`](file:///e:/MyFin/src/domain/transactions/splitInput.ts), [`recurringDay.ts`](file:///e:/MyFin/src/domain/recurring/recurringDay.ts), [`dateText.ts`](file:///e:/MyFin/src/domain/parser/dateText.ts), [`starterCategories.ts`](file:///e:/MyFin/src/data/io/starterCategories.ts)
- **Alerts & confirmations**: [`notificationInboxRepository.ts`](file:///e:/MyFin/src/data/dexie/notificationInboxRepository.ts), [`unreadableCaptureRepository.ts`](file:///e:/MyFin/src/data/dexie/unreadableCaptureRepository.ts), [`AlertsPage.tsx`](file:///e:/MyFin/src/pages/AlertsPage.tsx), [`ConfirmProvider.tsx`](file:///e:/MyFin/src/components/ConfirmProvider.tsx) / [`confirm.ts`](file:///e:/MyFin/src/lib/confirm.ts), Dexie schema v14 (`notificationInbox`, `unreadableCaptures`; both carried by backups and a PIN change)
- **Shell**: [`AppShell.tsx`](file:///e:/MyFin/src/components/AppShell.tsx), [`AndroidBackHandler.tsx`](file:///e:/MyFin/src/components/AndroidBackHandler.tsx), [`NotificationTapHandler.tsx`](file:///e:/MyFin/src/components/NotificationTapHandler.tsx), [`CaptureHealthBanner.tsx`](file:///e:/MyFin/src/components/CaptureHealthBanner.tsx), [`NotFoundPage.tsx`](file:///e:/MyFin/src/pages/NotFoundPage.tsx)
