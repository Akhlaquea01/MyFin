<div align="center">

# 💎 MyFin

**An offline-first, zero-knowledge personal finance manager and encrypted ledger.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![React](https://img.shields.io/badge/React-19-61dafb.svg?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.0-646cff.svg?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8.svg?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8.svg?logo=pwa&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps)
[![Security](https://img.shields.io/badge/Security-AES--256--GCM-green.svg)](docs/architecture.md)

</div>

---

## 🌟 Overview

**MyFin** is a modern, privacy-respecting Progressive Web App (PWA) designed to give you complete ownership of your personal finances. Unlike traditional cloud-based budgeting apps that centralize and monetize your bank records, MyFin runs **100% client-side**.

Every transaction, account balance, category, payee, and receipt attachment is encrypted in volatile browser memory before being committed to IndexedDB. No external servers. No cloud databases. No trackers.

---

## ✨ Features

- 🔐 **Zero-Knowledge Encryption**: All records encrypted with AES-256-GCM and PBKDF2 (600,000 rounds). Supports WebAuthn biometric unlock.
- 💳 **Multi-Account Ledger**: Track checking, savings, credit cards, investments, cash wallets, and loans in one unified double-sided register.
- 📉 **Debt Payoff Planner**: Simulate and execute **Debt Snowball** and **Debt Avalanche** payoff schedules with custom amortization modeling.
- 🎯 **Savings Goals**: Set visual milestone targets with dynamic pace projections based on your real savings rate.
- 🔔 **Recurring Bill Calendar**: Predictive scheduling for recurring income and expenses with envelope threshold overspending alerts.
- 🧾 **Encrypted Receipt Attachments**: Client-side compressed and encrypted image attachments stored securely alongside transactions.
- 🧠 **Smart Auto-Categorization**: Merchant normalization rules combined with streak-learning that surfaces automatic categorization suggestions.
- 📊 **Financial Health Score (0–100)**: Quantitative wellness diagnostic assessing emergency runway, savings rate, and debt-to-income (DTI) ratio.
- 📱 **PWA Web Share Target**: Native OS share integration allowing you to share bank SMS alerts and receipts directly into the quick-add drawer.
- 📥 **Multi-Account Statement Importer**: High-speed CSV and Excel parser with fuzzy column mapping and intelligent duplicate detection.
- 🤝 **Peer Lending & Borrowing**: Track money lent to or borrowed from contacts with settlement milestones and ledger integration.
- 📑 **Year-in-Review & Vector PDF Export**: Interactive annual retrospective infographic with vector-grade client-side PDF export.
- 🏷️ **Tag Taxonomy & Saved Filter Views**: Non-hierarchical multidimensional tagging with fast boolean query filters and saved presets.
- 🎨 **Starter Setup Templates**: Export and share sanitized configurations (categories, rules, budgets) without exposing private financial balances.
- 🚶 **Interactive Onboarding Tour**: Built-in spotlight guide introducing key workflows to new users.

---

## 🛡️ Security & Cryptography

MyFin follows a strict **zero-knowledge architecture**:

- **Symmetric Cipher**: **AES-256-GCM** with a cryptographically secure, unique 96-bit Initialization Vector (IV) per record.
- **Key Derivation**: **PBKDF2-HMAC-SHA256** with **600,000 iterations** derived from the user's master PIN.
- **Biometric Authentication**: Hardware-backed **WebAuthn PRF (Pseudo-Random Function)** extension for instant fingerprint/face unlock.
- **Searchable Encryption**: **HMAC-SHA256 Blind Indexing** with per-column salts enables indexed search on encrypted fields without leaking plaintexts.
- **Concurrency Isolation**: **Web Locks API** single-instance coordinator prevents concurrent tab write conflicts.

For a detailed technical breakdown, read the **[Architecture & Security Documentation](docs/architecture.md)**.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (`v20.x` or `v22.x` LTS recommended)
- [npm](https://www.npmjs.com/) (`v10.x` or higher)
- [Git](https://git-scm.com/)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Akhlaquea01/MyFin.git
   cd MyFin
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the local development server:
   ```bash
   npm run dev
   ```
   Navigate to [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🧪 Testing & Verification

MyFin includes a comprehensive suite of unit, integration, and end-to-end tests:

```bash
# Run unit & integration tests
npm run test:unit -- --run

# Run Playwright end-to-end tests
npm run test:e2e

# Run TypeScript type check
npm run check

# Check code formatting & linting
npm run lint

# Build production bundle
npm run build
```

---

## 📚 Documentation

Detailed documentation is available in the [`docs/`](docs/) directory:

- 📖 **[Documentation Hub](docs/README.md)**: Navigation and documentation index.
- 🏛️ **[System Architecture](docs/architecture.md)**: Deep dive into system layers, security model, storage engine, and data flows.
- 📋 **[Feature Catalog](docs/features.md)**: Complete specifications and domain engine logic for all 15 features.

---

## 🤝 Contributing

Contributions are welcome! Whether you are reporting a bug, proposing a feature, or writing code, please check out our **[Contributing Guidelines](CONTRIBUTING.md)** and **[Code of Conduct](CODE_OF_CONDUCT.md)**.

---

## 🔒 Vulnerability Disclosure

If you discover a security vulnerability, please review our **[Security Policy](SECURITY.md)** and contact us directly at **[akhalquea01@gmail.com](mailto:akhalquea01@gmail.com)** instead of opening a public issue.

---

## 📄 License

MyFin is open-source software licensed under the **[MIT License](LICENSE)**.

Copyright (c) 2026 [akhalque](https://github.com/Akhlaquea01).
