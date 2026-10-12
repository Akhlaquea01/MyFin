# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.0.x   | :white_check_mark: |

---

## Reporting a Vulnerability

We take the security and privacy of MyFin seriously. If you discover a security vulnerability, please do **not** open a public issue.

Instead, please send a detailed report to:

**[akhlaquea01@gmail.com](mailto:akhlaquea01@gmail.com)**

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

### Android app

- **Fingerprint unlock** uses Android's `BiometricPrompt` with a Keystore key that requires a fresh strong-biometric authentication for every use and is invalidated when fingerprints change. The PIN is never sent to native code, and the PIN always remains available.
- **Auto-capture** (optional, off until enabled) requests `RECEIVE_SMS` (it never reads the SMS inbox) and the user-granted "Notification access", and shows its own alert (`POST_NOTIFICATIONS`). Captured messages are sealed on arrival with a public key; the private key is stored encrypted with the PIN-derived key, so nothing readable is stored while the app is locked. Messages that cannot be about money, one-time codes and texts from phone numbers that do not read like a bank alert (a currency amount plus account or card digits) are discarded before anything is stored. Notifications are read only from a fixed list of payment, banking and messaging apps; a messaging app's notification is inspected in memory and kept only if it reads like a bank alert. Message text is never logged.
- The debug APK is installed from a file, not Play Store. Android may require "Allow restricted settings" before SMS or notification access can be granted; Google Play Protect may also warn about or block sideloaded apps that request these permissions.
