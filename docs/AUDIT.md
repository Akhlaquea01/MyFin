# MyFin — Engineering & QA Audit

Scope: the whole repository (React 19 + Vite PWA, Dexie/IndexedDB with AES-GCM row encryption, Capacitor
Android shell). The audit read the crypto/session/backup core, the ledger and every domain engine, the
import/export paths, the PWA and Android configuration, and then **fixed what it found, with regression
tests**. Nothing here is a claim that was not run: the commands used are listed in
[Verification](#verification).

Severity uses Critical / High / Medium / Low. No Critical defects were found: the encryption design,
PIN throttle, session handling, backup/restore atomicity and money arithmetic (integer minor units
throughout) all held up under review and under the new randomized ledger test.

---

## 1. Findings that were fixed

| #    | Sev    | Area              | Finding (observed → cause)                                                                                                                                                                                                                                                                                                                                           | Fix                                                                                                                                                                                                                                                      | Regression test                                                                      |
| ---- | ------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| F-01 | High   | Import (XLSX)     | A real Excel workbook imported **zero rows**. ExcelJS returns dates as `Date` objects and formula / rich-text / hyperlink cells as objects; `String(cell.value)` turned them into `"Thu Mar 05 2026…"` and `"[object Object]"`, so every row was skipped as an unparseable date or amount. (The only XLSX test used string cells.)                                   | `cellToText` converts dates to `YYYY-MM-DD`, formulas to their result, rich text/hyperlinks to their text, and rounds floating-point noise (`1234.5600000000002` → `1234.56`).                                                                           | `tests/unit/importService.test.ts` (round-trip through a real workbook)              |
| F-02 | High   | Data integrity    | An **emptied date input was stored as `""`**: Edit Transaction, Quick Add and Transfer-edit never validated it, so the entry vanished from every date-range query, period report and budget. New Transaction and Transfer refused to submit but showed no message.                                                                                                   | `isValidIsoDate` plus guards in `TransactionRepository.create/update`, `createTransferPair`, `editTransferPair`; inline messages in the forms. Only a date being _changed_ is checked, so entries holding an old odd date can still be deleted/restored. | `transactionDateValidation.test.ts`, `dateMath.test.ts`, `e2e/dataIntegrity.spec.ts` |
| F-03 | Medium | Import (dates)    | Real statements failed to import: `DD/MM/YY` (the format used in this repo's own test fixture) never parsed; `05-Mar-2026`, `05/03/2026 14:30` and 2-digit years were all rejected.                                                                                                                                                                                  | `parseDateWithFormat` now accepts `YY`, `MMM`/`MMMM`, a trailing time, and an unambiguous ISO date whatever the chosen format. Impossible dates are still rejected.                                                                                      | `importService.test.ts`                                                              |
| F-04 | Medium | Import (sign)     | Credit-card statements (purchases **positive**, payments negative) could not be imported with the right sign; only "negative = expense" or separate debit/credit columns existed.                                                                                                                                                                                    | New amount convention `positive-is-expense` (importer, mapping memory, UI).                                                                                                                                                                              | `importService.test.ts`                                                              |
| F-05 | Medium | Backup / restore  | After a restore (or any restore under a different PIN/salt) the remembered import-column layouts stayed encrypted under the **old** key. `ImportMappingRepository.list` then threw for every call, so "remember my columns" silently stopped working forever.                                                                                                        | Restore clears them inside its transaction; `list()` tolerates and discards unreadable rows.                                                                                                                                                             | `backupRestore.test.ts`, `importMappingRepository.test.ts`                           |
| F-06 | Medium | Debt planner      | The payoff simulation gave the extra payment only to the first debt each month. When that debt needed less than the budget, the remainder was **dropped for the month** (and a freed minimum was lost for a month), so payoff dates and total interest were too pessimistic.                                                                                         | Fixed monthly budget (all minimums + extra); what a nearly-cleared debt does not need spills into the next debt the same month.                                                                                                                          | `debtPayoffEngine.test.ts` (updated one wrong expectation, added 3 tests)            |
| F-07 | Medium | Performance / PWA | The whole app shipped as **one 2.37 MB script** (680 KB gzip) that the lock screen had to download and parse before showing anything.                                                                                                                                                                                                                                | Route-level `React.lazy` + Suspense: entry script **0.68 MB (−71 %)**; ExcelJS (954 KB) now loads only with Import/Export. All chunks stay precached (offline unaffected). One guarded reload recovers a tab whose chunks a redeploy replaced.           | `e2e/staleChunk.spec.ts`, `staleChunk.test.ts`                                       |
| F-08 | Medium | Privacy / PWA     | The share-target service worker stored shared text/images in the Cache API as **plaintext with no expiry**, and with no size limit; anything the app never collected stayed forever.                                                                                                                                                                                 | Shares expire after 24 h, text is capped, files over the app's own 20 MB limit are not buffered.                                                                                                                                                         | `tests/unit/shareTargetWorker.test.ts`                                               |
| F-09 | Medium | Sample / template | The downloadable **sample template shipped developer leftovers**: an account called "Ac" and one holding ₹888 billion, which wrecked net worth when imported. Importing any template also reported every Uncategorized split (all transfer legs) as a skipped "unresolved relationship", and a file with splits that did not add up **aborted the import half-way**. | Sample cleaned; placeholder category recognised; inconsistent splits / unusable dates are kept uncategorized or skipped _and reported_.                                                                                                                  | `tests/integration/sampleTemplate.test.ts`                                           |
| F-10 | Low    | Quick Add parser  | `…debited from your account 1234 towards ZOMATO` gave the merchant "your account 1234".                                                                                                                                                                                                                                                                              | `towards` is a payee cue; "your account…" is never a merchant.                                                                                                                                                                                           | `quickAddParser.test.ts`                                                             |
| F-11 | Low    | Mobile UI         | A balance of a crore or more **clipped** on a 360 px phone (`₹888,888,882,39…`); the "not backed up yet" banner squeezed its text into a sliver beside the buttons.                                                                                                                                                                                                  | Headline figure steps down with its length; banner text keeps a readable width and buttons wrap below.                                                                                                                                                   | screenshot-verified at 360 px                                                        |
| F-12 | Low    | Tooling           | `npm run lint` failed (12 ESLint errors, 39 files failing Prettier); a rule referenced by component tests was never loaded.                                                                                                                                                                                                                                          | Fixed config (`ignoreRestSiblings`, react-hooks plugin for component tests), removed unused imports/`any`, formatted.                                                                                                                                    | `npm run lint` is green                                                              |
| F-13 | Low    | Docs              | README/architecture said the on-device key uses 600,000 PBKDF2 rounds (it is **210,000**; 600,000 applies to backup files). Features doc said Trash purges after 30 days (nothing is auto-purged), "SHA-256 HMAC" (it is a checksum), listed account types that do not exist, and linked to `file:///e:/…` paths.                                                    | Corrected.                                                                                                                                                                                                                                               | —                                                                                    |
| F-14 | Low    | Accessibility     | Tour's previous-step icon button had no accessible name; no skip link; no safe-area inset on the phone header; `viewport-fit=cover` missing so the bottom bar's existing `env(safe-area-inset-bottom)` was always 0.                                                                                                                                                 | Label, skip-to-content link + focusable `<main>`, `viewport-fit=cover`, top inset.                                                                                                                                                                       | e2e suite                                                                            |
| F-15 | Low    | Dependencies      | 18 npm advisories (1 critical); `fake-indexeddb` and `@types/*` listed as runtime deps.                                                                                                                                                                                                                                                                              | `npm audit fix` (patch/minor, transitive only) → 11 left, all in dev tooling or non-exploitable (see §4); test-only packages moved to `devDependencies`.                                                                                                 | build + all suites green                                                             |

### Verified correct (no change needed)

- **Money**: every entry point goes through `parseMoneyToMinorUnits`; amounts are integers end to end.
  A seeded random-operation test (create / edit / delete / restore / transfer / convert-to-transfer /
  edit-transfer, 4 seeds × 60 steps, plus concurrent saves) asserts after _every_ step that each balance
  equals opening balance + live entries, splits sum to the amount, and transfer legs stay paired.
- **Crypto & auth**: AES-256-GCM with a fresh IV per row, non-extractable keys, salted PIN verifier
  compared in constant time, exponential lockout shared by every PIN prompt, session key cleared on lock,
  biometric only ever unwraps the PIN, restore re-encrypts everything in one transaction.
- **Backup**: validated (decrypt + checksum) before anything is written; the app re-opens the file it just
  made before handing it over; restore and PIN change are all-or-nothing.
- **Export**: spreadsheet-formula injection is neutralised.
- **Layout**: no horizontal overflow on any of the 32 routes at 360 px, with and without data.

---

## 2. Features added

| Feature                         | What / why                                                                                                                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Check my data** (Backup page) | Read-only integrity audit: balances vs entries, split totals, transfer pairs, invalid dates, dangling account/category references, with a one-click **Rebuild balances** (balances are derived data). `src/data/io/integrityService.ts`. |
| Credit-card import              | `positive-is-expense` amount convention (F-04).                                                                                                                                                                                          |
| More statement date formats     | `YY`, `MMM`, trailing time, ISO (F-03); the Import page now explains the tokens.                                                                                                                                                         |
| App shortcuts                   | Long-press the installed icon: _New transaction_, _Paste a bank message_; manifest `id`/`scope`/`categories` pinned.                                                                                                                     |
| Faster start                    | Per-route code splitting (F-07).                                                                                                                                                                                                         |

## 3. Feature gaps (not implemented — need a product decision or device testing)

- Multi-currency (the app is INR-only by design: one symbol, no FX).
- Low-balance and card **payment-due** reminders (only the statement day is stored; the forecast page
  warns but nothing notifies).
- Transactions list: amount-range filter, multi-select bulk edit/delete/categorise, and a card layout on
  phones (today the table scrolls sideways to reach amounts' decimals and the action buttons).
- Light/system theme (the app is pinned to dark with no toggle; light tokens exist but the category and chart
  palette was validated for contrast only against the dark surface, so a light theme needs that redone).
- Scheduled backups never rotate (one file per run accumulates) and are not re-opened after writing.
- Per-device encryption key (Android Keystore) so a PIN alone is not the only protection of stored data.

## 4. Remaining risks (prioritised)

1. **High — Android builds are debug-signed with a committed, public keystore and are `debuggable`.**
   Anyone can build an APK that installs _over_ the user's app (same signature, higher version code) and
   read its storage; `adb run-as` also exposes it. This is documented and was chosen so updates install
   without uninstalling, but it contradicts the zero-knowledge claim for anyone who can run a modified
   build. Fixing it means a private release key — which, being a different signature, forces a one-time
   uninstall/reinstall, so ship it with a "make a backup first" migration. Not changed here for that reason.
2. **Medium — The PIN is the only secret, and the lockout is app-level only.** The verifier
   (`pinVerifierHash`, 210,000 PBKDF2 rounds) sits unencrypted in `userProfile`; with the storage extracted
   (item 1, a rooted/stolen unlocked device) a 6-digit PIN is ~10⁶ offline guesses. Mitigations to consider:
   longer passphrase option, Argon2/scrypt in a worker, a Keystore-wrapped device key.
3. **Medium — Heavy work runs on the main thread** (PBKDF2 on every unlock, CSV/XLSX parsing up to
   20,000 rows, PDF generation, decrypting the whole ledger on every Transactions refresh). Large ledgers
   will stutter on low-end phones; move crypto/parsing to a Worker and page the ledger.
4. **Low — `recalculateAccountBalance` is read-modify-write and not serialised per account.** A stale
   write is theoretically possible if two saves interleave on real IndexedDB (not reproducible against
   `fake-indexeddb`, even with staggered concurrent saves). _Check my data → Rebuild balances_ repairs it.
5. **Low — Goal projection** divides saved amount by the span _between_ first and last contribution, so two
   contributions a month apart project double the real pace. It is the documented spec (research.md §1) and
   is pinned by tests, so it was left alone.
6. **Low — Share target** accepts a cross-site POST (it buffers text/images that the user must still confirm
   in the app). INTERNET permission is declared although the app is offline-only (CSP `connect-src 'self'`
   already blocks exfiltration). The PWA icons are generated placeholders and the "maskable" icon is the
   same artwork without a safe zone.
7. **Low — npm advisories left**: `shadcn` CLI and `@capacitor/cli` dependency trees (dev tooling only),
   `exceljs → uuid` (the flagged code path, `uuid` v3/v5/v6 with a caller-supplied buffer, is not used —
   ExcelJS only calls `v4()`). `npm audit fix --force` would _downgrade_ ExcelJS to 3.x, so it was not run.

## 5. Verification

Environment note: Node 22.22.0 is below the repo's `engines` floor (22.22.2) and Playwright's pinned
Chromium build is not installed, so installs used `npm_config_engine_strict=false` and the end-to-end run
used the pre-installed Chromium through a throwaway config (not committed).

| Check                                   | Before                                      | After                                      |
| --------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| `npm run check` (tsc)                   | clean                                       | clean                                      |
| `npm run lint` (Prettier + ESLint)      | 12 errors, 39 files unformatted             | clean                                      |
| `npx vitest --run` (unit + integration) | 133 files / 1,257 tests                     | **139 files / 1,303 tests**, all passing   |
| `npm run build`                         | ok, entry chunk 2,369 kB                    | ok, entry chunk 683 kB                     |
| `vite build --mode capacitor`           | —                                           | ok, no service worker emitted              |
| Playwright e2e (desktop + mobile)       | could not run unmodified (browser mismatch) | **123 / 123 passing** (10 min, one worker) |

New tests: ledger invariants (random sequences), integrity service, transaction date validation,
sample template import, share-target worker, stale-chunk guard, debt-planner spill-over, parser, date
formats, XLSX cells, restore → import mappings; e2e specs `dataIntegrity` and `staleChunk`.

Honesty note on the end-to-end history: the first complete run on the modified code showed 3 failures —
one receipt-attachment timing flake while the machine was also running other test processes, and two
because the build output was swapped underneath the running preview server. Each passed when re-run, and
the final full run, on an otherwise idle machine, was 123/123.

How to re-run: `npm ci && npm run lint && npm run check && npx vitest --run && npm run build &&
npx playwright test`.

---

## 6. Second audit — cross-feature gaps (2026-10-17)

Scope: the whole repository again, concentrating on what the purpose tags, card auto-capture, the
Recurring/Subscriptions merge and the Categories revamp added on top of the code §1–§5 covered. `tsc`,
ESLint and all 1,438 unit/integration tests were already green; every defect below was found by reading
the code, **reproduced with a failing test first**, then fixed. Regression tests:
`tests/integration/crossFeatureInvariants.test.ts` and `tests/integration/auditFollowUps.test.ts`.

### 6.1 Fixed

| #    | Sev    | Area               | Finding (observed → cause)                                                                                                                                                                                                                                                                                                  | Fix                                                                                                                                                                                                                                                       |
| ---- | ------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-01 | High   | Budgets            | **Rollover was computed from a stale month.** A new month's rollover read the previous item's _stored_ `actualAmount`, which is only refreshed when the Budgets page or the unlock check last ran. Spending recorded afterwards (Quick Add, import, capture) never reached it: ₹9,000 spent of ₹10,000 rolled over ₹10,000. | `ensureBudgetItemForPeriod` recomputes the closed month's actual from the ledger before deriving the rollover (`budgetEngine.ts`).                                                                                                                        |
| G-02 | High   | Data transfer      | **Data-template import silently dropped fields**: a holding's `units`/`avgPrice` (it came back as a legacy cost-only holding), a paused rule's `isActive` (came back active), a budget's `rolloverMode`, an account's low-balance threshold, a merchant's "dismissed from Subscriptions".                                   | `templateService.ts` carries them over; `AccountRepository.create` now persists `lowBalanceThresholdMinor`.                                                                                                                                               |
| G-03 | Medium | Recurring / Alerts | **Pausing a rule did not stop its reminders.** Pause only flipped `isActive`; the already-generated pending events kept raising "Upcoming: Recurring" alerts (and OS notifications), still showed on Upcoming, and a paused rule could still claim a matching transaction.                                                  | Pause drops the pending events (resume regenerates them); the reminder check and Upcoming ignore events of inactive rules; `matchTransaction` skips inactive rules. **Reverses a test that pinned the old "pause is only a flag" behaviour — see below.** |
| G-04 | Medium | Accounts           | **An account could be deleted while a recurring payment was paid from it**, leaving the rule pointing at a missing account (shown as a raw id, still generating reminders). Deleting a card account that a liability was linked to also made that debt vanish from net worth.                                               | `AccountRepository.remove` refuses while recurring rules use it; new `deleteAccount` (`domain/accounts/accountDeletion.ts`) unlinks liabilities and clears the capture default; page message added.                                                       |
| G-05 | Medium | Purpose tags       | **Deleting a savings goal, debt or investment made every entry tagged to it uneditable** ("That savings goal no longer exists." on any amount/date/account change, and on Review confirm). Only recurring-rule deletion cleaned up.                                                                                         | `detachPurposeTarget` (`purposeEngine.ts`) keeps the tag but drops the dead target; called from the three delete handlers.                                                                                                                                |
| G-06 | Medium | Transfers          | **"Record as transfer" onto an existing entry left that entry's old effects behind**: a savings tag and its goal contribution stayed on what is now a transfer leg, and a recurring payment stayed "paid" by it.                                                                                                            | `convertToTransfer` clears the counterpart's purpose and releases its recurring match.                                                                                                                                                                    |
| G-07 | Medium | Auto-capture       | **Captured messages could stall with no sign.** If the default account was archived or deleted, every message stayed queued ("no account"), counted in the drain report but shown nowhere; the settings page still showed the dead account as selected.                                                                     | A toast with a "Fix" action when messages cannot be filed; the settings page no longer offers a dead default.                                                                                                                                             |
| G-08 | Medium | Privacy            | **Unclaimed shared text/photos stayed in the Cache API indefinitely**: the worker only pruned expired shares when the _next_ share arrived, so §1 F-08's 24-hour expiry did not hold. "Clear all data" also left them.                                                                                                      | `purgeStaleSharedPayloads` runs after every unlock; `clearSharedPayloads` runs in `resetEverything`.                                                                                                                                                      |
| G-09 | Low    | Accounts           | Changing an account's type between card and non-card in Edit re-read the unchanged number under the other sign convention, flipping the balance (a 5,000 debt became 5,000 in hand).                                                                                                                                        | The number is negated with the type switch, so the stored balance is preserved.                                                                                                                                                                           |
| G-10 | Low    | Imports            | A row that failed part-way through a file/bulk-text import left the rows already created with no balance recalculation. `recordTransaction`'s recurring-match step (documented as "never fails the transaction") was not guarded.                                                                                           | Balances are recalculated in `finally`; the match step is wrapped in `try/catch`.                                                                                                                                                                         |
| G-11 | Medium | Recurring          | **Upcoming listed every event ever generated, oldest first**, with only a category name: after a few months it opened on last year's paid bills, two rules in one category were indistinguishable, and no amount appeared.                                                                                                  | Soonest first with the last 30 days for context (older payments behind a "Show N earlier" toggle); each row shows the rule's name, account and amount (`RecurringUpcomingPage.tsx`).                                                                      |
| G-12 | Medium | Data transfer      | **A failed data-template import left a half-imported file**: new accounts and categories, no transactions, balances not recalculated, and re-running duplicated what had landed.                                                                                                                                            | `importDataTemplate` takes a raw (still encrypted) snapshot of the data tables first and restores it in one Dexie transaction if any step throws; the error says nothing was changed (`data/dexie/snapshot.ts`).                                          |
| G-13 | Medium | Auto-capture       | **200+ unfileable messages hid every fileable one behind them**: with no usable default account they stayed at the head of the phone's oldest-first queue.                                                                                                                                                                  | Such messages are acknowledged and kept in the app ("Messages waiting for an account" on the Auto-capture page), and retried on every drain once an account exists. No Java change.                                                                       |
| G-14 | Low    | Loans              | **Person-loan create/repayment/remove were multi-step**: a failure between the ledger entry and the loan row orphaned the movement; a removal that failed half-way could never be retried (the entry it wanted to delete was gone).                                                                                         | Create/repayment take the entry back out if the record cannot be written; removal deletes the record first, then the entry, and tolerates the entry already being gone.                                                                                   |
| G-15 | Low    | Check my data      | Did not look at records pointing at a missing account, category, entry, goal, loan or rule (how G-04 went unnoticed).                                                                                                                                                                                                       | New `dangling-reference` findings for recurring rules, reminders, budgets, debts and their payments, investment trades, loans and repayments, goal contributions, tagged entries and the capture default account. Report-only.                            |
| G-16 | Low    | Analytics          | **Analytics ignored refunds while Budgets netted them**: ₹2,000 refunded on ₹5,000 of Shopping read ₹5,000 in the chart and ₹3,000 in the budget.                                                                                                                                                                           | `categoryBreakdown` nets money in against spend per category (never below zero), like Budgets. "Uncategorized" counts only money out, since its money in is unlabelled.                                                                                   |
| G-17 | Low    | Recurring          | **Every edit, confirm or delete decrypted every expected event ever generated** to find the one an entry had paid (the matched id is encrypted), so confirming a queue was O(entries × events).                                                                                                                             | `releaseMatches` narrows on the unencrypted `status`/`expectedDate` columns (paid events due within 25 days of the entry's current and previous date) before decrypting.                                                                                  |
| G-18 | Low    | Review             | "Confirm all categorized" stopped at the first entry that could not be confirmed and reported only its error text.                                                                                                                                                                                                          | Each entry is tried on its own; the toast says how many were confirmed and names the first that was not.                                                                                                                                                  |

**Behaviour change to review (G-03).** `tests/integration/recurringRuleManagement.test.ts` had a test named
"pausing is still just a flag: no reminder is touched". It was changed to assert the new behaviour. If keeping
pending reminders across a pause was intended, revert the pause branch of `updateRecurringRule`; the read-side
filters in G-03 still stop the alerts. Likewise two cases in `budgetRollover.test.ts` fabricated a previous
item's `actualAmount` with no transactions behind it; they now record real spending.

### 6.2 Known limits left in place

1. **Data-template import still does not rebuild the debt, savings and trade links.** Goal contributions are
   imported without their `transactionId`, a liability's `payments` and a holding's `trades` are not carried
   across, and entries tagged for a debt or goal keep the tag without naming the target (deliberate: naming it
   would let a later edit apply the entry a second time). Those entries lose their "managed elsewhere"
   protection after a round trip. (The import is now all-or-nothing, G-12.)
2. **Person-loan writes are compensated, not a single database transaction** (G-14): the ledger entry is built
   with the engine, which encrypts and cannot share a Dexie transaction. A crash (rather than an error) between
   the two writes can still orphan an entry; it is then an ordinary, deletable ledger entry.
3. **`releaseMatches` trusts a 25-day window** (G-17): an event is only looked for among paid events due within
   25 days of the entry's current or previous date, which is wider than either matching window. A paid event
   whose entry was moved by a path that does not pass the old date would not be freed.
4. **The Analytics category chart and the monthly income/expense trend now differ by the month's refunds**
   (G-16): the chart nets a refund against its category; the trend keeps cash-flow meaning, where a refund is
   money in. On the Dashboard, the spending-by-category chart and the month's expense figure can therefore differ by that month's refunds.
5. **Messages waiting for an account are capped at 100** (the oldest are dropped), the same cap as the unreadable
   list; the phone's own queue has its own cap.

---

## 7. Third audit — calculations (2026-10-18)

Scope: every place the app computes a figure — money and dates, the ledger and balances, budgets and
rollover, analytics, the dashboard, financial health, forecast, net worth, investments, loans, goals, the
debt planner, recurring dates, and the import/capture amount parsers. The core arithmetic (integer minor
units, balance = opening + entries, paired transfers, the payoff simulation, loan balances) held up.
Each defect below was reproduced with a failing test, then fixed.

### 7.1 Fixed

- **H-01 (Medium) Dashboard budget bars and the health score read stale spend.** A budget's saved
  `actualAmount` only moves when it is opened, so spending recorded since (Quick Add, an import) left the
  Dashboard bar where it was and let an over-limit budget count as "within limit" in the health score.
  Both now use `withLiveBudgetActuals`, as the Analytics card already did.
- **H-02 (Medium) The forecast ignored a bill due today.** The loop starts tomorrow and today's pending
  events were dropped; they now land on the first projected day.
- **H-03 (Medium) Forecast drift was always divided by 90.** A 20-day-old account's spending was spread over
  90 days. It is now averaged over the days the account has been in use, from 30 to 90.
- **H-04 (Medium) Buying on a holding with no unit data replaced its cost basis** with just the new
  purchase's cost. Such a holding must now be given its units first (Edit → "Units held"; the cost basis is
  kept exactly and the average price is worked out from it).
- **H-05 (Low) Cost basis drifted from what was paid.** It was re-derived as units × the rounded average
  price (up to half a paisa per unit). It is now the exact sum paid, cut to the remaining share on a sale;
  re-saving a holding with untouched units and price keeps it.
- **H-06 (Low) Goal pace counted the first deposit as saved over the months after it.** Two deposits of
  1,000 a month apart read as 2,000 a month. The pace is now what came in after the first day, over the months
  since. The goal contract and its tests were updated. A goal 99.6% saved no longer reads 100%.
- **H-07 (Low) A yearly rule drifted by a day in leap years.** `dayOfPeriod` was a plain day of the year, so
  a rule made from 1 March was 2 March in the other years. A yearly rule is now a calendar date: a month
  (`monthOfYear`, new, optional) and a day of that month in `dayOfPeriod`, clamped to the month's length as a
  monthly rule's 31st is, so there is no leap-year logic at all and 29 February is the 28th in other years.
  The rule form and the Review "Mark as recurring" dialog ask for a month and a day. **Compatibility:** a
  yearly rule saved before this has no month and still holds a day of the year; it is read as that date of an
  ordinary year (60 = 1 March, 366 = 31 December) and gets its month the next time it is saved. One made from
  a date after February in a leap year (2024, 2028) holds a number one too high and falls a day late; edit it once.
- **H-08 (Low) "Adjust balance" counted as income or spending.** It now posts a one-sided movement marked
  `balance_adjustment` (like a loan or a trade), so it moves the balance but stays out of income, expenses,
  budgets and the forecast's drift. The ledger labels it "Adjustment" and it is edited as itself. Adjustments
  posted before this change remain ordinary income/expense entries.
- **H-09 (Low) Sinking funds ignored spending in a month the app was not opened**, overstating the fund. Each
  skipped period now adds its allowance and loses what was spent (never below zero).
- **H-10 (Low) The balance sparkline** walked back entries of archived accounts that were never in the total.
- **H-11 (Low) A card paid past what it owed** dropped out of net worth; its credit now counts as an asset.
- **H-12 (Low) `formatMoneyCompact`** wrote ₹999.50 as "₹1000" (now "₹1K").

Regression tests: `balanceAdjustment.test.ts`, `holdingEditDialog.test.tsx`, `balanceAdjustment.spec.ts`, and
cases added to the budget, dashboard, health, forecast, goal, recurring, investment, net-worth and money
suites. `budgetPerformanceCard.test.tsx` ("reports a failed load…") and `alertsPaging.test.tsx` can time out
when the whole suite runs in parallel and pass alone; this predates the audit.

### 7.2 Known limits left in place

1. **Forecast drift keeps a 30-day floor**, so an account used for fewer than 30 days still has its spending
   spread over 30: a few days of history cannot be stretched into a forecast by one large payment.
2. **A sale does not record a realised gain**; the remaining holding's gain/loss is shown, the proceeds are
   money in the account.
