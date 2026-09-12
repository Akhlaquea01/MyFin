# Contributing to MyFin

Thank you for your interest in contributing to MyFin! We are building an offline-first, zero-knowledge personal finance application that respects user privacy.

---

## Code of Conduct

All contributors and participants agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before participating.

---

## Development Setup

### Prerequisites
- **Node.js**: `v20.x` or `v22.x` (LTS recommended)
- **npm**: `v10.x` or higher
- **Git**

### Installation

1. **Fork & Clone** the repository:
   ```bash
   git clone https://github.com/Akhlaquea01/MyFin.git
   cd MyFin
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the local development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Repository Structure

```text
src/
├── components/          # Reusable UI components & Radix primitives
│   └── ui/              # Shadcn / Radix accessible UI primitives
├── context/             # React context (SessionContext, Auth state)
├── data/
│   ├── crypto/          # WebCrypto AES-GCM, PBKDF2, blind indexing
│   ├── dexie/           # Dexie IndexedDB repositories & schema
│   ├── io/              # Import, export, backup, migrations, and template services
│   └── storage/         # Storage persistence API checks
├── domain/              # Pure functional calculation engines (Zero side effects)
│   ├── analytics/       # Cashflow, dashboard, and financial health engines
│   ├── budgets/         # Budget envelope & rollover engines
│   ├── categorization/  # Rule matching & merchant streak engines
│   ├── debtPlanner/     # Snowball, avalanche, and amortization engines
│   ├── notifications/   # Recurring bill reminders & threshold alert engines
│   ├── personLoans/     # Peer-to-peer debt calculations
│   ├── recurring/       # Recurring frequency rule projections
│   ├── reports/         # Annual review and category aggregation
│   ├── savingsGoals/    # Milestone tracking & pace projection
│   └── transactions/    # Double-entry balance calculation & tag filtering
├── hooks/               # Custom React hooks
├── lib/                 # Single-instance lock, WebAuthn, and utilities
└── pages/               # Top-level view pages
docs/                    # System architecture & feature catalog
tests/                   # Unit, integration, component, and E2E Playwright tests
```

---

## Architectural Conventions

When contributing code, adhere to these fundamental architectural rules:

1. **Pure Functional Domain Engines**:
   - All financial math, schedule projections, rollover calculations, and metrics must live in `src/domain/`.
   - Domain functions must be **pure and deterministic** (no database calls, no network requests, no direct state mutations).
   - Domain functions should maintain comprehensive unit test coverage.

2. **Zero-Knowledge Data Storage**:
   - Financial data must never be saved unencrypted in IndexedDB, LocalStorage, or session storage.
   - All persistent user data must flow through `EncryptedTable` with AES-256-GCM encryption.
   - Searchable fields must utilize HMAC blind indexes with per-column salts.

3. **Single-Instance Safety**:
   - Do not bypass the single-instance coordinator (`src/lib/singleInstance.ts`). Only one active tab is allowed write access to prevent database conflicts.

---

## Testing & Quality Assurance

Before submitting any code, verify all automated checks pass:

```bash
# Type check
npm run check

# Code formatting & linting
npm run lint

# Automatically format files
npm run format

# Run unit and integration tests
npm run test:unit -- --run

# Run Playwright end-to-end tests (optional for UI changes)
npm run test:e2e

# Verify production bundle builds cleanly
npm run build
```

---

## Submitting a Pull Request

1. **Create a branch**:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/your-bugfix-name
   ```
2. **Commit your changes**:
   - Write clear, concise commit messages adhering to conventional commits (e.g., `feat:`, `fix:`, `docs:`, `test:`).
3. **Push to your fork**:
   ```bash
   git push origin feat/your-feature-name
   ```
4. **Open a Pull Request**:
   - Provide a clear description of the problem solved, design choices made, and screenshots/videos for UI updates.

---

## Questions or Need Help?

Open an issue on GitHub: [https://github.com/Akhlaquea01/MyFin/issues](https://github.com/Akhlaquea01/MyFin/issues).
