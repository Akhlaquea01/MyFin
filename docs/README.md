# MyFin Documentation Hub

Welcome to the documentation for **MyFin**, an offline-first, zero-knowledge personal financial manager and encrypted double-sided ledger.

## Documentation Navigation

- **[System Architecture & Design (`architecture.md`)](./architecture.md)**
  - High-level system architecture and Mermaid component diagrams.
  - Zero-knowledge security model and cryptographic specifications (AES-256-GCM, PBKDF2, blind indexing).
  - Storage layer (Dexie / IndexedDB), single-instance concurrency protection, and pure functional domain engines.
  - Data flows for cold-start unlocks and encrypted transaction persistence.

- **[Feature Specifications & Catalog (`features.md`)](./features.md)**
  - Detailed catalog of all 15 implemented features:
    1. Core Personal Finance Manager & Encrypted Ledger
    2. Debt Payoff Planner (Snowball & Avalanche)
    3. Savings Goals Tracker
    4. Recurring Budget Notifications
    5. Encrypted Receipt Attachments
    6. Auto-Categorization & Merchant Learning
    7. Financial Health Insights & Score (0–100)
    8. PWA Web Share Target
    9. Multi-Account Statement File Import
    10. Lending & Borrowing (Person Loans)
    11. Year In Review Report & Vector PDF Export
    12. Tag Taxonomy & Search Engine
    13. Saved Transaction Filter Presets
    14. Interactive Quick Tour & Guided Onboarding
    15. Starter Setup Template Export & Import

---

## Technical Stack Summary

- **Framework**: React 19, React Router v7
- **Language**: TypeScript 6 (strict mode)
- **Styling**: Tailwind CSS v4, Lucide Icons, Shadcn / Radix UI
- **Database**: IndexedDB via Dexie.js v4
- **Cryptography**: Web Crypto API (SubtleCrypto: AES-GCM, PBKDF2, HMAC-SHA256)
- **Offline / PWA**: Vite Plugin PWA, Workbox, Web Share Target API
- **Testing**: Vitest, React Testing Library, Playwright (E2E)
