# Development setup

Everything needed to run MyFin locally. For how to test see [TESTING](../testing/TESTING.md); for
producing a release or an APK see [BUILD](../deployment/BUILD.md); for the code layout see the
[LLD](../architecture/LLD.md#1-source-map).

## Prerequisites

| Tool    | Version                          | Notes                                                                                                                                                                      |
| :------ | :------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js | `^22.22.2`, `^24.15.0` or `>=26` | CI and local development use **24**. `.npmrc` sets `engine-strict=true` and jsdom needs this range, so Node 20 and older 22/24 releases refuse to install the dependencies |
| npm     | the one bundled with Node        | Use `npm ci` for a reproducible install; the lockfile is `package-lock.json`                                                                                               |
| Git     | any recent                       |                                                                                                                                                                            |

Not needed for day-to-day work: Android Studio, the Android SDK or Java. The APK is compiled by
GitHub Actions; see [BUILD](../deployment/BUILD.md). (A JDK is only useful to regenerate a test
fixture, see [TESTING](../testing/TESTING.md#java-code).)

## First run

```bash
git clone https://github.com/Akhlaquea01/MyFin.git
cd MyFin
npm ci
npm run dev
```

Open <http://localhost:5173>. The first screen asks you to create a PIN; all data stays in that
browser profile's IndexedDB. There are no environment variables to set and no backend to start.

In development the PWA plugin generates a service worker into `dev-dist/` (gitignored). If the app
behaves oddly after switching branches, unregister the service worker and clear site data in the
browser's developer tools.

## npm scripts

| Script                              | What it does                                                  |
| :---------------------------------- | :------------------------------------------------------------ |
| `npm run dev`                       | Vite dev server on port 5173                                  |
| `npm run build`                     | `tsc -b` (type check) then `vite build` into `dist/`          |
| `npm run build -- --mode capacitor` | The Android build: same output folder, PWA service worker off |
| `npm run preview`                   | Serves `dist/` on port 4173 (what the e2e tests run against)  |
| `npm run check`                     | `tsc -b --noEmit`; `check:watch` keeps it running             |
| `npm run lint`                      | `prettier --check .` then `eslint .`                          |
| `npm run format`                    | `prettier --write .`                                          |
| `npm run test:unit`                 | Vitest in watch mode (add `-- --run` for a single pass)       |
| `npm run test:e2e`                  | `playwright install` then the Playwright suite                |
| `npm test`                          | Unit/integration/component tests once, then the e2e suite     |

## Repository configuration files

| File                                                        | Purpose                                                                                                                |
| :---------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `package-lock.json`, `.npmrc`               | Dependencies, scripts, `engine-strict`                                                                                 |
| `vite.config.ts`                                            | Vite + React + Tailwind + PWA plugin, the build-time CSP, the `@` alias and the **Vitest projects** (`node` and `dom`) |
| `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`  | Project references: the app (`src/`) and the config files                                                              |
| `eslint.config.js`, `prettier.config.js`, `.prettierignore` | Lint and format rules (tabs, single quotes, 100 columns, Tailwind class sorting)                                       |
| `playwright.config.ts`                                      | e2e projects (desktop, mobile), web server, timeouts                                                                   |
| `capacitor.config.ts`                                       | Android app id, name and web directory                                                                                 |
| `components.json`                                           | shadcn/ui CLI configuration (aliases, style)                                                                           |
| `index.html`                                                | Vite entry document                                                                                                    |
| `.github/workflows/`                                        | `ci.yml` (checks and tests) and `build-apk.yml` (APK and release)                                                      |
| `.vscode/`                                                  | Shared recommended extensions and a CSS association (no machine-specific settings)                                     |
| `.gitignore`, `.gitattributes`                              | Ignored paths; line-ending normalisation                                                                               |

## Editor

Install the extensions in `.vscode/extensions.json` (Prettier, ESLint, Tailwind CSS IntelliSense).
Format on save with Prettier so `npm run lint` stays clean.

## Line endings on Windows

The repository stores LF (`.gitattributes`: `* text=auto eol=lf`, with `*.bat` kept CRLF). A
checkout made **before** that file existed, with `core.autocrlf=true`, still has CRLF files in the
working tree, and `prettier --check .` reports them as unformatted although the committed content is
fine. Until those files are re-checked-out, compare content only:

```bash
npx prettier --check . --end-of-line auto
```

and judge a change by the files you touched. CI runs on Linux and never sees the difference.

## Everyday workflow

1. Branch from `master` (`feat/...`, `fix/...`).
2. Change code; keep `npm run check` and `npm run lint` clean.
3. Add or update tests ([TESTING](../testing/TESTING.md)).
4. Open a pull request; `ci.yml` must be green. See [CONTRIBUTING](../../CONTRIBUTING.md).
