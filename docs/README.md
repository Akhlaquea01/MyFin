# MyFin documentation

MyFin is an offline-first, zero-knowledge personal finance manager: a React PWA with an optional
Android shell. Start here to find the right document.

## Find what you need

| I want to…                                                         | Read                                                             |
| :----------------------------------------------------------------- | :--------------------------------------------------------------- |
| Understand what MyFin is made of and why                           | [architecture/HLD.md](architecture/HLD.md)                       |
| Find a module, follow a data flow, add a page or table             | [architecture/LLD.md](architecture/LLD.md)                       |
| Run the app locally, see the scripts and config files              | [development/SETUP.md](development/SETUP.md)                     |
| Contribute code (standards, pull requests)                         | [CONTRIBUTING.md](../CONTRIBUTING.md)                            |
| Run or write tests, understand CI                                  | [testing/TESTING.md](testing/TESTING.md)                         |
| Build for production, host the web app, build and release the APK  | [deployment/BUILD.md](deployment/BUILD.md)                       |
| Know what a feature does                                           | [product/FEATURES.md](product/FEATURES.md)                       |
| Learn what differs on Android, or set up bank-message auto-capture | [product/ANDROID_APP.md](product/ANDROID_APP.md)                 |
| Fix a build, install or environment problem                        | [maintenance/TROUBLESHOOTING.md](maintenance/TROUBLESHOOTING.md) |
| See why something is the way it is                                 | [maintenance/DECISIONS.md](maintenance/DECISIONS.md)             |
| Read the audit history and known limits                            | [maintenance/AUDIT-LOG.md](maintenance/AUDIT-LOG.md)             |
| Report a vulnerability                                             | [SECURITY.md](../SECURITY.md)                                    |

## Layout

```text
docs/
├── README.md                this index
├── architecture/            HLD.md (system, principles, security) · LLD.md (modules, flows, native layer)
├── development/             SETUP.md
├── testing/                 TESTING.md
├── deployment/              BUILD.md
├── product/                 FEATURES.md (catalog) · ANDROID_APP.md
└── maintenance/             TROUBLESHOOTING.md · DECISIONS.md · AUDIT-LOG.md
```

`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` and `LICENSE` stay at the
repository root because GitHub looks for them there.

## Technical stack at a glance

|               |                                                     |
| :------------ | :-------------------------------------------------- |
| Framework     | React 19, React Router v7                           |
| Language      | TypeScript 6 (strict)                               |
| Styling       | Tailwind CSS v4, Radix UI / shadcn, Lucide icons    |
| Storage       | IndexedDB through Dexie v4                          |
| Cryptography  | Web Crypto API (AES-GCM, PBKDF2, SHA-256, RSA-OAEP) |
| Offline / PWA | vite-plugin-pwa (Workbox), Web Share Target         |
| Android       | Capacitor 8 + local Java plugins                    |
| Tests         | Vitest, Testing Library, Playwright, JUnit          |

## Keeping the docs healthy

- One home per fact: link to it instead of copying it. Behaviour of a feature goes in
  `product/FEATURES.md`; how it is built goes in the LLD; a decision that would be undone by mistake
  goes in `maintenance/DECISIONS.md`.
- Use relative links, and check them after moving a file (every link in this folder resolves).
- Update a document in the same pull request that changes what it describes. Audit entries are
  history and are not edited afterwards.
