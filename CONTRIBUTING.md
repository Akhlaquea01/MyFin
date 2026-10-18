# Contributing to MyFin

Thank you for your interest in contributing to MyFin! We are building an offline-first, zero-knowledge
personal finance application that respects user privacy.

All contributors and participants agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Getting started

Prerequisites, installation, the npm scripts and the configuration files are described in
**[docs/development/SETUP.md](docs/development/SETUP.md)**. In short, with Node 24:

```bash
git clone https://github.com/Akhlaquea01/MyFin.git
cd MyFin
npm ci
npm run dev        # http://localhost:5173
```

To find your way around the code, read the [LLD source map](docs/architecture/LLD.md#1-source-map);
for the why behind the design, the [HLD](docs/architecture/HLD.md).

---

## Coding standards

**Language and style**

- TypeScript in strict mode. Prettier (tabs, single quotes, 100 columns, sorted Tailwind classes) and
  ESLint are the formatter and linter; `npm run format` fixes formatting.
- React components and pages: `PascalCase.tsx`. Every other module: `camelCase.ts`. Tests mirror the
  module as `<module>.test.ts(x)`. Keep app-specific components out of `src/components/ui/`, which holds
  shadcn primitives.
- Money is an integer in the smallest currency unit, never a float; format only at the display edge.

**Architectural rules** (the reasons are in [HLD §3](docs/architecture/HLD.md#3-design-principles)):

1. **Calculations are pure functions.** Financial math, schedule projections, rollover and metrics go
   in `src/domain/` as deterministic functions with unit tests. Code that must read data
   (a `*Service`, or an engine that loads through repositories) stays thin and calls those functions.
   `domain/` and `data/` never import from `components/`, `pages/`, `hooks/` or `context/`.
2. **Zero-knowledge storage.** Financial data is never saved unencrypted in IndexedDB, `localStorage`
   or `sessionStorage`. Persist through `EncryptedTable`. Searchable text (merchant aliases, tag names)
   is indexed by a salted blind-index digest (`blindIndex` in `cryptoService.ts`), never by its
   plaintext. Nothing financial goes to the console or to error messages.
3. **Single-instance safety.** Do not bypass `src/lib/singleInstance.ts`; only one tab may unlock and
   write.
4. **No network from the web layer.** The CSP forbids it. A feature that needs a server needs a
   deliberate decision first (see [BUILD](docs/deployment/BUILD.md#configuration-and-environment-variables)).
5. **Tests with the change.** Money logic needs unit tests; repository changes need integration
   tests; new core flows need a Playwright spec. See [TESTING](docs/testing/TESTING.md).

---

## Before you open a pull request

```bash
npm run check          # type check
npm run lint           # prettier --check . && eslint .
npx vitest --run       # unit, integration and component tests
npm run test:e2e       # Playwright (optional for logic-only changes; ~10 minutes)
npm run build          # production bundle builds cleanly
```

The same checks run on every pull request and on pushes to `master`
([`ci.yml`](.github/workflows/ci.yml)); a pull request should be green before it is merged. CI checks
out with Unix line endings; on Windows `npm run lint` can report formatting problems on files you did
not change when your working tree has CRLF — see
[SETUP](docs/development/SETUP.md#line-endings-on-windows) and judge it by the files you touched.

If you change user-visible behaviour, update [docs/product/FEATURES.md](docs/product/FEATURES.md); if
you change how something is built, the matching page under `docs/` (see the
[documentation index](docs/README.md)).

---

## Submitting a pull request

1. **Create a branch** from `master`:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/your-bugfix-name
   ```
2. **Commit** with clear, concise messages following conventional commits (`feat:`, `fix:`, `docs:`,
   `test:`, `refactor:`, `chore:`).
3. **Push** to your fork:
   ```bash
   git push origin feat/your-feature-name
   ```
4. **Open a pull request** describing the problem solved, the design choices made, and screenshots or
   video for UI changes.

Please do not commit personal tooling or machine-specific files (editor state, local AI-assistant
directories, `.env` files, build output, test reports); `.gitignore` covers the usual ones.

---

## Security issues

Do not open a public issue for a vulnerability; follow [SECURITY.md](SECURITY.md).

## Questions or need help?

Open an issue on GitHub: <https://github.com/Akhlaquea01/MyFin/issues>.
