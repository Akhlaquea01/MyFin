# Technical decisions

An index of the decisions that shape the code and would surprise a newcomer, each with its reason and
the place that holds the detail. It is deliberately short: the reasoning lives next to the code or in
the linked document. When you make a decision that a future reader would otherwise undo by mistake,
add a row here and put the explanation beside the code.

Open risks and known limits are listed in the [audit log](AUDIT-LOG.md) (§4 remaining risks, §6.2 and
§7.2 known limits); they are not repeated here.

## Architecture and security

| Decision                                                                           | Why                                                                                                                                                                                                                             | Detail                                                                                                       |
| :--------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------- |
| No backend, no telemetry; CSP `connect-src 'self'`                                 | Zero-knowledge promise must hold even if script injection succeeds                                                                                                                                                              | `vite.config.ts` (`cspPlugin`), [HLD §2](../architecture/HLD.md#2-system-context)                            |
| CSP is injected in production builds only                                          | The dev server's React Refresh preamble is an inline script that `script-src 'self'` blocks                                                                                                                                     | `vite.config.ts`                                                                                             |
| Encrypt the whole entity, index only structural columns                            | Amounts, notes and names never touch disk in the clear, while dates, ids and status stay queryable                                                                                                                              | `src/data/dexie/db.ts`, [LLD §3](../architecture/LLD.md#3-data-layer)                                        |
| PBKDF2 at 210,000 rounds on device, 600,000 for backups                            | The on-device key runs on every unlock (with an attempt lockout); a backup file can be attacked offline                                                                                                                         | `src/data/crypto/cryptoService.ts`, [HLD §6](../architecture/HLD.md#6-security-model)                        |
| The session key may persist only as a non-extractable `CryptoKey` with an expiry   | Lets a reload resume an unlocked session without exposing key bytes                                                                                                                                                             | `SessionKeyRow` in `db.ts`, HLD Principle II                                                                 |
| Deletes are permanent (schema v15 dropped `deletedAt`; the Trash page was removed) | A product choice: every delete asks for confirmation and says it cannot be undone. The v15 upgrade also purges rows that were already in Trash, so nothing is orphaned (the original rationale for the removal is not recorded) | `db.ts` v15, commit `dc3ae86`, [HLD §3](../architecture/HLD.md#3-design-principles)                          |
| Captured bank messages are _sealed_ with a public key on arrival                   | Native receivers run without the PIN and must not leave a message readable                                                                                                                                                      | [LLD §6](../architecture/LLD.md#6-android-native-layer)                                                      |
| The biometric secret only unwraps the PIN, never replaces it                       | The PIN stays the root secret; a changed fingerprint set invalidates the wrapper                                                                                                                                                | [Android app](../product/ANDROID_APP.md)                                                                     |
| Android `allowBackup="false"`                                                      | The encrypted ledger and session key must never reach a Google account                                                                                                                                                          | `android/app/src/main/AndroidManifest.xml`                                                                   |
| Share target is its own service worker at scope `/share-target`                    | It must not change the offline asset-cache policy of the Workbox worker                                                                                                                                                         | `public/sw-share-target.js`, [LLD §5.4](../architecture/LLD.md#54-share-target-web--publicsw-share-targetjs) |
| Workbox precache limit raised to 3 MiB instead of excluding a chunk                | Excluding it would leave the app shell partly uncached and break offline-after-first-load                                                                                                                                       | `vite.config.ts`                                                                                             |

## Android packaging and release

| Decision                                                               | Why                                                                                                                           | Detail                                                                                                  |
| :--------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| The APK build (`--mode capacitor`) has no PWA service worker           | A service worker in the WebView's persistent storage would keep serving the previous version's UI after an update             | `vite.config.ts`, [BUILD](../deployment/BUILD.md)                                                       |
| `appId` and `server.androidScheme` never change                        | Android and the WebView key installed data to them; changing either orphans every user's database                             | `capacitor.config.ts`, [BUILD](../deployment/BUILD.md#changing-the-apps-identity)                       |
| A public debug keystore is committed and used for every build          | Identical signatures let updates install in place without a Play account. Trade-off recorded as the top risk in the audit log | [BUILD](../deployment/BUILD.md#signing-key), [AUDIT-LOG §4](AUDIT-LOG.md#4-remaining-risks-prioritised) |
| Version = `MAJOR.MINOR` + commit count; `versionCode` = commit count   | Every commit gets a higher version with no version-bump commits. **History on `master` must never be rewritten**              | [BUILD](../deployment/BUILD.md#versions-and-releases), `.github/workflows/build-apk.yml`                |
| Releases are published by a separate job, only for the tip of `master` | The job that runs npm and Gradle never holds a write token; re-running an old workflow cannot offer a downgrade               | `.github/workflows/build-apk.yml`                                                                       |
| Third-party GitHub Actions are pinned to full commit SHAs              | A moved tag cannot change what runs                                                                                           | `.github/workflows/*.yml`                                                                               |
| In-app update talks to GitHub from native code only, on a button press | The web layer stays unable to make network requests                                                                           | [Android app](../product/ANDROID_APP.md), `NativeAppUpdatePlugin.java`                                  |

## Product behaviour fixed by the calculation audit (2026-10-18)

Recorded in [AUDIT-LOG §7](AUDIT-LOG.md#7-third-audit--calculations-2026-10-18); the non-obvious ones:

- Buying units on a holding without unit data is refused until its units are entered; cost basis is the
  exact sum paid.
- Goal pace is saved amount (minus first-day deposits) over months since the first deposit.
- Forecast drift averages the account's real history, floored at 30 days and capped at 90.
- A yearly recurring rule is a calendar date (month + day, clamped to the month's length).
- "Adjust balance" posts a one-sided transfer labelled "Adjustment", outside income, expense and budgets.
- Dashboard budgets and Financial Health read live spend rather than the stored budget item.

## Product behaviour fixed by the relations audit (2026-10-19)

Recorded in [AUDIT-LOG §8](AUDIT-LOG.md#8-fourth-audit--relations-between-features-2026-10-19); the
non-obvious ones:

- An account with an active recurring payment cannot be archived (a paused one does not stand in the way),
  as it cannot be deleted.
- `TransactionEngine.deleteTransaction` refuses the entry behind a person loan, an investment trade or a
  liability payment; the owning page removes its record first, then the entry. An entry tagged as a debt
  payment is the exception: deleting it gives the money back to the debt.
- Changing a budget's period type (monthly ↔ yearly) clears its earlier periods.
- A budget's current period follows spend back-filled into the period before it, while rollover is on;
  turning rollover off keeps what had already rolled in.
- Removing a goal contribution that came from an entry keeps the entry's Savings tag but takes the goal
  off it.
- Changing the PIN keeps the key salt (the replay ledger and searchable digests are salted with it).

## Testing and tooling

| Decision                                          | Why                                                                                                                    | Detail                                                                     |
| :------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------- |
| Playwright runs with one worker                   | Each spec onboards a fresh install and PBKDF2 runs on the main thread; parallel runs failed on timeouts                | `playwright.config.ts`, [TESTING](../testing/TESTING.md#writing-e2e-specs) |
| Vitest is split into a `node` and a `dom` project | A single Node environment could not render components, which once let a stale-closure bug that disabled auto-lock ship | `vite.config.ts`                                                           |
| `expect.requireAssertions: true`                  | A test without an assertion passes silently                                                                            | `vite.config.ts`                                                           |
| `engine-strict=true`                              | The dependency tree needs a specific Node range; fail at install, not at run time                                      | `.npmrc`                                                                   |
| `src/components/ui/` holds shadcn primitives only | Keeps generated code separable from app components                                                                     | `components.json`, [LLD §1](../architecture/LLD.md#1-source-map)           |
