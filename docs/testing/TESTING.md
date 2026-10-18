# Testing

How MyFin is tested, the commands to run each layer, and what CI does. Money logic is the product, so
the bar is high: see [HLD Principle IV](../architecture/HLD.md#3-design-principles).

## Strategy

| Layer         | Where                               | Runner / environment                            | What it proves                                                                                                               |
| :------------ | :---------------------------------- | :---------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| Unit          | `tests/unit/` (70 files)            | Vitest, `node` project                          | Pure logic: engines, parsers, policies, crypto helpers, native-wrapper fallbacks                                             |
| Integration   | `tests/integration/` (62 files)     | Vitest, `node` project, `fake-indexeddb`        | Repositories and services against a real Dexie schema: ledger invariants, backup/restore, import, migrations, capture ingest |
| Component     | `tests/component/` (28 files)       | Vitest, `dom` project (jsdom + Testing Library) | Screens and components in isolation: lock screen, session auto-lock, error boundaries, pickers, charts                       |
| End-to-end    | `tests/e2e/` (53 specs)             | Playwright on Chromium against the built app    | Whole flows in a browser: onboarding, ledger, import/export, budgets, recurring, mobile layout                               |
| Native (Java) | `android/app/src/test/` (3 classes) | JUnit via Gradle                                | Pure Java used by the capture and update plugins: `CaptureFilter`, `SealedBox`, `UpdateRules`                                |

Cross-language check: `tests/unit/javaSealedFixture.test.ts` opens an item sealed by the **real**
Java `SealedBox`, so a format disagreement between Android and the web fails in CI instead of on a
phone.

## Commands

```bash
npm run check                      # type check (tsc -b --noEmit) — covers src/ and the config files
npm run lint                       # prettier --check . && eslint .
npx vitest --run                   # all unit, integration and component tests once
npx vitest --run --project node    # only unit + integration
npx vitest --run --project dom     # only component tests
npx vitest --run tests/unit/money.test.ts   # one file
npm run test:unit                  # watch mode
npx playwright test                # whole e2e suite (builds and serves the app itself)
npx playwright test tests/e2e/budgeting.spec.ts --project=desktop   # one spec
npm run test:e2e                   # same, after `playwright install` (downloads every browser)
npm test                           # vitest once, then e2e
```

`tests/` is not part of the `tsc` project (`tsconfig.app.json` includes only `src/`), so test files
are checked by ESLint and executed, not type-checked by `npm run check`.

## Vitest configuration

Defined in `vite.config.ts` under `test.projects`:

- **`node`** — includes `src/**/*.{test,spec}.*`, `tests/unit/**` and `tests/integration/**`; setup file
  `tests/setup/fake-indexeddb.ts` installs a real IndexedDB implementation.
- **`dom`** — includes `tests/component/**`; environment jsdom; setup files `fake-indexeddb.ts` and
  `tests/setup/dom.ts` (Testing Library matchers, cleanup, a `matchMedia` stub, Web Crypto).
- `expect.requireAssertions: true` — a test with no assertion **fails**.

Conventions: one test file per module, named `<module>.test.ts(x)` under the matching folder; import
the code under test with a relative path (`../../src/...`).

Pitfalls worth knowing:

- `fake-indexeddb` accepts `null` as an index key, real IndexedDB does not. Keep using
  `src/data/dexie/indexable.ts` (`''` sentinel) so tests stay representative.
- Date handling: parse date-only strings (`'2026-12-01'`) with `isoDateToLocalDate`
  (`domain/shared/dateMath.ts`), not `new Date(...)`, which is UTC midnight. To exercise another time
  zone, set `process.env.TZ = 'America/New_York'` inside the test and restore it in `afterEach`.
- Tests that do real PBKDF2 or dozens of encrypted writes run 3–5× slower when the whole suite runs in
  parallel than alone (`alertsPaging` goes from ~1 s to 5–6 s). A file like that sets
  `vi.setConfig({ testTimeout: 30_000 })` inside its `describe` and, if it waits on the UI,
  `configure({ asyncUtilTimeout: 5_000 })` from Testing Library (see `alertsPaging.test.tsx`,
  `holdingEditDialog.test.tsx`). Do not raise timeouts globally.
- Wait for the thing you assert. `await screen.findByText(...)` for an element that appears after
  async work; never assert synchronously right after a side-effect signal such as a toast — the UI
  that follows it may not have rendered yet (that was `budgetPerformanceCard`'s failure).
  Measure with `npx vitest --run --reporter=json --outputFile=out.json`, which records every test's
  duration.

## Writing e2e specs

Configuration is `playwright.config.ts`:

- Two projects: `desktop` (every spec except `*.mobile.spec.ts`) and `mobile` (`*.mobile.spec.ts`,
  Pixel 7 profile with touch and a small viewport).
- **One worker.** Every spec onboards a fresh install, and each unlock runs a 210,000-iteration PBKDF2;
  parallel runs failed on timeouts under CPU contention. The whole suite takes about ten minutes.
  Do not run other CPU-heavy work alongside it, and do not rebuild `dist/` while it runs.
- `webServer` runs `npm run build && npm run preview` on port 4173 (allow up to 240 s).
- A seeded `localStorage` entry (`APP_QUICK_TOUR_SEEN`) keeps the guided tour from covering the page;
  `quickTour.spec.ts` resets it for the one test that needs the tour.
- `tests/e2e/helpers.ts` has the shared steps: `openScreen(page, hub, screen)` for screens folded
  into Data / Automation / Settings, `lockAndReload`, `clearSessionKey`, and confirm-dialog helpers.

Selector traps (they have broken unrelated specs before):

- `getByLabel`, `getByText` and `getByRole(..., { name })` match by **case-insensitive substring**
  unless `exact: true`. A new `aria-label` containing "To", "Amount" or "Name" breaks every
  `getByLabel('To' | 'Amount' | 'Name')` — even on a `display: none` element. A new link whose name
  contains "Import", "Quick Add" or "Accounts" collides with the existing ones.
- `getByRole('button' | 'link')` ignores hidden elements; `getByText` and `getByLabel` do not.
- The split-amount input must keep `placeholder="Amount"`; the empty ledger text "No transactions
  yet." is asserted.
- Nested Radix dialogs close top-first, so one `Escape` may leave the outer one open. Close every
  dialog explicitly where a spec depends on it.

Before adding a label, link or button, grep `tests/e2e` for the words it contains.

## Java code

`android/app/src/test/java/.../` holds JUnit tests for `CaptureFilter`, `SealedBox` and `UpdateRules`.
They run in CI as part of `./gradlew testDebugUnitTest assembleDebug`
([BUILD](../deployment/BUILD.md)); running Gradle locally needs the Android SDK and JDK 21.

The two classes that are pure Java compile with a plain JDK. To regenerate
`tests/fixtures/javaSealedItem.json` after changing `SealedBox`, follow the instructions at the top of
`tests/fixtures/MakeSealedFixture.java` (it needs only `javac` and `java`).

Receivers, permission prompts and the fingerprint prompt cannot be tested off a device; they are
checked by hand on a phone (see [Android app](../product/ANDROID_APP.md#checking-auto-capture-on-a-phone)).

## Continuous integration

| Workflow           | Trigger                                | Does                                                                                                                                                                                                                                            |
| :----------------- | :------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml` › `check` | pull request, push to `master`, manual | `npm ci` → `npm run lint` → `npm run check` → `npx vitest --run` (Node 24, Ubuntu)                                                                                                                                                              |
| `ci.yml` › `e2e`   | same                                   | `npm ci` → `npx playwright install --with-deps chromium` → `npx playwright test --retries=2 --trace=on-first-retry`; uploads `playwright-report/` and `test-results/` for 14 days. A spec that passes on retry is reported as flaky, not failed |
| `build-apk.yml`    | push to `master`, manual               | Capacitor web build, `cap sync`, Gradle JUnit tests and `assembleDebug`, APK verification, then a GitHub Release                                                                                                                                |

A pull request should be green before it is merged. Generated reports (`playwright-report/`,
`test-results/`) are gitignored and never committed.
