# MyFin — Feature Documentation

This document provides a comprehensive reference of all 15 core features built into the MyFin application, detailing user workflows, business logic, domain engines, data models, and UI surfaces.

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

---

## Feature 001: Core Personal Finance Manager & Encrypted Ledger

### Overview
The foundational layer of MyFin providing zero-knowledge, local-first personal financial management. All sensitive data (transactions, accounts, budgets, payees) is stored encrypted in browser IndexedDB.

### Key Capabilities
- **Accounts Management**: Support for multiple account types (`bank`, `credit`, `cash`, `investment`, `loan`, `wallet`).
- **Encrypted Double-Sided Ledger**: Immutable transaction history supporting income, expense, and account transfers.
- **Split Transactions**: Allocate a single transaction across multiple categories.
- **PIN & Biometric Authentication**: Onboarding PIN entry with PBKDF2 key derivation and WebAuthn biometrics unlock.
- **Encrypted Backup & Restore**: AES-GCM encrypted single-file backup export with SHA-256 HMAC integrity verification.
- **Soft-Delete & Trash Recovery**: 30-day soft-delete lifecycle for transactions and accounts with full restore capability.

### Domain Engine & Architecture
- **Engine**: [`src/domain/transactions/transactionEngine.ts`](file:///e:/MyFin/src/domain/transactions/transactionEngine.ts)
- **Repositories**: [`accountRepository.ts`](file:///e:/MyFin/src/data/dexie/accountRepository.ts), [`transactionRepository.ts`](file:///e:/MyFin/src/data/dexie/transactionRepository.ts), [`categoryRepository.ts`](file:///e:/MyFin/src/data/dexie/categoryRepository.ts)
- **Primary Pages**: [`DashboardPage.tsx`](file:///e:/MyFin/src/pages/DashboardPage.tsx), [`AccountsPage.tsx`](file:///e:/MyFin/src/pages/AccountsPage.tsx), [`TransactionsPage.tsx`](file:///e:/MyFin/src/pages/TransactionsPage.tsx), [`NewTransactionPage.tsx`](file:///e:/MyFin/src/pages/NewTransactionPage.tsx)

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
- **Recurring Cadences**: Daily, weekly, bi-weekly, monthly, quarterly, and annual frequency rules.
- **Expected Events Generation**: Projects future transaction occurrences with status tracking (`scheduled`, `paid`, `overdue`, `skipped`).
- **Budget Threshold Alerts**: Configurable alerts when category spend exceeds 80%, 90%, or 100% of budgeted envelope.
- **In-App Notification Center**: Notification inbox with persistence, read/unread states, and action navigation.
- **Service Worker Push/Notification Integration**: Local browser notification scheduling without external server dependence.

### Domain Engine & Architecture
- **Engines**: [`src/domain/recurring/recurringEngine.ts`](file:///e:/MyFin/src/domain/recurring/recurringEngine.ts), [`src/domain/notifications/notificationEngine.ts`](file:///e:/MyFin/src/domain/notifications/notificationEngine.ts)
- **Repositories**: [`recurringRepository.ts`](file:///e:/MyFin/src/data/dexie/recurringRepository.ts), [`notificationRepository.ts`](file:///e:/MyFin/src/data/dexie/notificationRepository.ts)
- **Primary Pages**: [`RecurringPage.tsx`](file:///e:/MyFin/src/pages/RecurringPage.tsx), [`RecurringUpcomingPage.tsx`](file:///e:/MyFin/src/pages/RecurringUpcomingPage.tsx), [`BudgetsPage.tsx`](file:///e:/MyFin/src/pages/BudgetsPage.tsx)

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
- **Exact & Substring Pattern Rules**: Match merchant descriptions using regex or exact normalized substring matching.
- **Merchant Normalization**: Strips store IDs, card terminal suffixes, and location noise (e.g. `STARBUCKS #10294 NY` -> `Starbucks`).
- **Streak Learning Engine**: When a user confirms the same category for an unrecognized merchant 3 consecutive times, the engine surfaces an automatic rule suggestion.
- **Bulk Re-classification**: One-click application of new rules retroactively across unreviewed transactions.

### Domain Engine & Architecture
- **Engine**: [`src/domain/categorization/categorizationEngine.ts`](file:///e:/MyFin/src/domain/categorization/categorizationEngine.ts), [`src/domain/parser/merchantResolver.ts`](file:///e:/MyFin/src/domain/parser/merchantResolver.ts)
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
- **Quick-Add Text Parsing**: Natural language parser extracting amount, date, payee, and category from shared SMS/text snippets (e.g. "Paid $45.20 at Shell on 12/04").
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
- **Per-Row Account Resolution**: Routes transactions to existing accounts based on file columns or allows mapping unknown accounts to new ledger accounts on the fly.
- **Intelligent Duplicate Detection**: Scopes duplicate detection by account, transaction date, amount, and reference index to prevent double entries.
- **Review Queue**: Imported transactions land in an unreviewed queue allowing batch verification before permanent inclusion.

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
