# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.0.x   | :white_check_mark: |

---

## Reporting a Vulnerability

We take the security and privacy of MyFin seriously. If you discover a security vulnerability, please do **not** open a public issue.

Instead, please send a detailed report to:

**[akhalquea01@gmail.com](mailto:akhalquea01@gmail.com)**

Please include:
- A description of the vulnerability and its potential impact.
- Step-by-step instructions to reproduce the issue or a proof-of-concept.
- Any suggested fixes or mitigations.

We will acknowledge receipt of your report within 48 hours and provide a timeline for addressing the issue.

---

## Zero-Knowledge Architecture

MyFin operates entirely client-side with a zero-knowledge threat model:
- Financial records are encrypted using **AES-256-GCM** before being saved to IndexedDB.
- Master keys are derived in volatile memory using **PBKDF2-HMAC-SHA256** with 600,000 rounds.
- Searchable fields utilize HMAC blind indexing with distinct per-column salts.
- Volatile keys are purged from memory upon session lock or inactivity timeout.
- Unencrypted data is never sent to external servers or third-party analytics.
