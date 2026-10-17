# Building the MyFin Android APK

MyFin is a static Vite + React app. [Capacitor](https://capacitorjs.com) wraps the built `dist/` folder in an Android WebView, and a GitHub Actions workflow
([`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml)) compiles it into an installable **debug APK** on a GitHub-hosted Ubuntu runner.
You do not need Android Studio, the Android SDK, or Java on your PC. Every build from `master` is also published as a **GitHub Release** (`MyFin-vX.Y.Z.apk`), and the app can
check that release and install it by itself (**About → App updates**), so there is no download-and-share step.

```
npm run build -- --mode capacitor   →   dist/
npx cap sync android                →   copies dist/ into android/
./gradlew assembleDebug             →   android/app/build/outputs/apk/debug/app-debug.apk
```

## One-time setup

1. **Commit and push** the Android files to the `master` branch of your GitHub repository: `android/` (including `android/app/debug.keystore`), `capacitor.config.ts`,
   `.github/workflows/build-apk.yml`, and the `package.json` / `package-lock.json` changes.
2. Make sure GitHub Actions is enabled: repository **Settings → Actions → General → Allow all actions** (this is the default).
3. That's it. There are no secrets to configure, and public repositories get free Actions minutes. The release step uses the workflow's own token (the `release` job asks for
   `contents: write`; the build job stays read-only). If a run fails there with "Resource not accessible by integration", check **Settings → Actions → General → Workflow permissions**
   and that no organisation policy blocks write tokens.
4. The repository must stay **public**: the app downloads updates from the release without a login. For a private repository the update check would get a 404.

## Build the APK

- **Automatically:** every push to `master` starts a build.
- **Manually:** repository **Actions** tab → **Build Android APK** → **Run workflow** → choose the branch → **Run workflow**.

The first run takes roughly 5–10 minutes; later runs are faster because npm and Gradle downloads are cached. When the run finishes, its summary shows the build number and the
signing-certificate fingerprint.

## Versions and releases

Every build gets a new, higher version without anyone editing a file:

- **Version** = `MAJOR.MINOR` from `version` in `package.json` + the **number of commits** as the patch. With `"version": "0.1.0"` and 93 commits the build is **0.1.93**, the file is
  `MyFin-v0.1.93.apk` and the release is tagged `v0.1.93`. To start a new line (for example `0.2`), change `package.json` to `0.2.0`; its patch number is ignored.
- **`versionCode`** (the integer Android compares) is the same commit count. It only ever goes up, which is what lets each APK install over the last. Rewriting `master`'s history so
  the commit count drops would make Android refuse the next update.
- **Release notes** are the commit subjects since the previous release. Only the newest commit on `master` is published (re-running an old workflow never creates a release), and a
  re-run of the same commit replaces the file in its release instead of failing.
- Nothing is committed back by CI, so there are no version-bump commits to merge. Your local `npm run dev` shows the `package.json` version (`0.1.0`); the APK shows the CI one.

## Download and install

**Easiest — from the phone:** open <https://github.com/Akhlaquea01/MyFin/releases/latest> and tap `MyFin-vX.Y.Z.apk`. No login and no unzipping.

**Inside the app (once a build with this feature is installed):** **Settings → About → App updates → Check for updates**. If a newer version is published it shows the version, size
and notes; **Download and install** fetches it, checks it, and opens Android's installer. The first time, Android sends you to a screen to allow MyFin to **install unknown apps** —
switch it on, go back, and tap **Install**. Android always asks you to confirm; an app cannot update itself silently. Your data stays.

**From the workflow run (the old way):**

1. Open the finished (green) run and scroll to **Artifacts**. Download **`myfin-debug-apk`** — GitHub delivers it as a `.zip`.
2. Unzip it to get `MyFin-vX.Y.Z.apk`. You can do this on your PC and copy the file to the phone, or open the zip with the phone's Files app.
3. Tap the APK on the phone. Android asks you to allow **Install unknown apps** for the app you opened it from (Files, Chrome, …) — allow it once, then **Install**.
   If Play Protect warns about an unknown developer, choose **Install anyway**: this is a debug build that is not distributed through Google Play.

**Updating:** install a newer APK straight over the old one. Your data is kept, because every build is signed with the same committed debug key and each build has a higher
version number (the commit count). Run artifacts are kept for 30 days; releases are kept until you delete them. A phone that has a build from before in-app updates needs one manual
install of a newer APK first; after that it can update itself.

> **Back up first.** Uninstalling the app, or clearing its storage, permanently deletes everything in it. Use **Backup** inside MyFin before doing either.

## What is different on Android

- **Export and Backup** open Android's share sheet (Save to Drive, Files, send to another app, …) instead of downloading to a folder. The file is first written to the app's
  private cache. If you dismiss the sheet, MyFin reports "Save cancelled." and no file was saved.
- **Data stays on the device.** The app disables Android's cloud auto-backup (`android:allowBackup="false"`) so your encrypted ledger and session key are never uploaded to a Google
  account. Moving to a new phone therefore works through MyFin's own encrypted Backup → Restore, not through Android's phone-to-phone transfer.
- **Fingerprint unlock** works through Android's own fingerprint prompt (the browser's WebAuthn is not available inside Android WebView). Turn it on from **Security** in the
  menu (or from the offer after you unlock with your PIN). The PIN still works and is still what protects your data: the fingerprint only fetches a key that unlocks your PIN
  on this phone. The lock screen opens the fingerprint prompt by itself when you come back to the app after being away longer than your **auto-lock** time (default 5
  minutes; change it under **Security**); coming back sooner does not ask again. Adding or removing a fingerprint in Android settings switches MyFin's fingerprint unlock off on
  purpose: enter your PIN and turn it on again. It needs a fingerprint sensor (or face unlock) that Android rates as _strong_; some face unlock is rated weaker and will be
  reported as unavailable.
- **Share into MyFin**: MyFin appears in Android's share sheet. Share a bank SMS (text) from your messages app and it opens **Quick Add** with the message parsed; share a receipt
  photo and it opens **New Transaction** with the image attached; share a bank statement downloaded as **CSV or Excel** and it opens **Import** with the file loaded for column
  mapping. A share made while MyFin is locked waits and opens after you unlock. Images and statements over 10 MB are refused with a message. If you are partway through typing a
  transaction, MyFin asks before a share replaces it (and offers to open the share later if you decline).
- **Reminders are real Android notifications**: bill reminders, budget alerts and overdue-loan reminders now appear as Android notifications (the browser's notification API does not
  exist inside the app). MyFin asks once (Android 13+ shows the system permission dialog), and they are shown when you unlock the app, not on a schedule while it is closed — nothing
  financial is handed to Android's alarm scheduler to be stored and fired later. They appear under the channel **Bill and budget reminders** (hidden on the lock screen). Each one is
  also listed under **Alerts** in the menu (with an unread count), whether or not notifications are allowed, and tapping the notification opens the matching screen.
- **Automatic backups to a folder**: under **Backup → Automatic backups**, **Choose backup folder** opens Android's folder picker (Storage Access Framework — no storage permission is
  needed, and MyFin can only touch the one folder you pick). Choose a folder that Google Drive, Syncthing or similar already watches, and each scheduled backup (checked every time you
  unlock with your PIN — the backup is encrypted with it) leaves the phone as a new encrypted `myfin-auto-backup-YYYY-MM-DD.json` file. Old files are not deleted. If Android
  revokes the folder, the next run is recorded as failed and the page says so. **Remind me weekly** additionally schedules a notification with fixed text (no financial details) so
  a missed backup does not go unnoticed; it is the one notification MyFin hands to Android's scheduler.
- **In-app updates** (**About → App updates**): MyFin looks up the newest release of its own repository on GitHub, downloads `MyFin-vX.Y.Z.apk`, checks it (size, GitHub's SHA-256,
  that it is MyFin, that it is newer, that it is signed with the installed app's key) and hands it to Android's installer. It only happens when you press the buttons — there is no
  background checking. The request is made by the app's native code, not the web page, to `api.github.com` and the release download of this one repository; GitHub sees your IP
  address and a generic `MyFin-Android-Updater` name, nothing from your data. The page itself still cannot make network requests. Android shows its own confirmation, and asks once
  to allow MyFin to **install unknown apps** (the `REQUEST_INSTALL_PACKAGES` permission). Google Play Protect may still warn about a file-based app that reads SMS; choose **Install
  anyway**.
- **Not available in the APK** (they rely on browser features; MyFin hides or skips them): the PWA update prompt (replaced by **App updates** above) and the "browser couldn't
  guarantee protected storage" banner. Take regular Backups — see above.
- The hardware/gesture **Back** button follows the app: it first closes an open dialog or the navigation drawer, then steps back through MyFin's pages, and from the Dashboard leaves
  the app.
- **Lock when I leave the app** (Security → Auto-lock) locks MyFin once it has been out of the foreground for more than 30 seconds, whatever the auto-lock time.

## Auto-capture of bank messages

MyFin can add bank transactions to your **Review** queue by itself: it reads incoming bank SMS, and notifications from payment and banking apps (Google Pay, PhonePe, Paytm,
BHIM, CRED and the HDFC, ICICI, SBI, Axis and Kotak apps). It is off until you turn it on under **Auto-capture** in the menu (the page only exists in the APK).

1. **Add the last digits of each account** under Accounts (for example `1234`, from "A/c XX1234" in your bank's messages). Messages are filed under the account whose digits they
   name; anything else goes to the **default account** you choose.
2. Open **Auto-capture** and: allow **Read incoming SMS**, switch on **Notification access** for MyFin in Android's list, and allow the **alert** (Android 13+). Pick the default
   account and **Turn on auto-capture**. MyFin first locks and unlocks a test message to prove the phone and the app agree before it captures anything.
3. New transactions then appear in Review with an **SMS** or **Notification** badge, the original message under **Original message**, and **Edit** if the amount, account, merchant or
   date need fixing. One payment seen as both an SMS and an app notification becomes one entry. Entries on a guessed account say **Account not matched — check**.

**What is and is not read.** Only SMS that look like completed money movements are kept; one-time codes, offers, balance alerts, failed payments and bill reminders are discarded
without being stored. A text from a phone number is kept only if it reads like a bank alert (a currency amount plus the account or card digits, like "INR 97.00 debited A/c no. XX0146"),
so a bank alert forwarded by a friend still files, but "I paid you Rs 500" does not. Notifications are read only from the payment/banking and messaging apps listed in
`CaptureFilter.java` (package names change between app versions — check with `adb shell pm list packages`; an app missing from the list is simply not captured from). A messaging app's
notification (Google Messages, Samsung Messages) is the only way MyFin sees a bank alert that arrives over RCS rather than as an SMS; its text is looked at in memory and kept only if it
reads like a bank alert, and the same alert seen as both SMS and notification becomes one entry. MyFin never reads your SMS inbox (it only holds the receive permission), never logs
message text, and nothing leaves the phone.

**Locked or closed.** Messages that arrive while MyFin is closed or locked are locked away on arrival with a public key; the matching private key is stored encrypted with your PIN-derived
key, so nothing readable is kept. They are opened and filed the next time you unlock. The alert only says how many are waiting.

**If Android blocks it.** An app installed from a file is treated as risky for SMS and notification access. If the permission is refused, or the "Notification access" switch is greyed
out: open **App info** for MyFin, tap the **⋮ menu**, choose **Allow restricted settings**, then try again (the menu only appears after one blocked attempt). The Auto-capture page has
buttons for both screens. Google Play Protect may also warn about, or refuse, installing a file-based app that asks for SMS or notification access; **Install anyway** works, and
`adb install` is the fallback. If a phone's battery saver stops MyFin, allow it to run in the background, or messages arrive late or not at all. Receivers only start working after MyFin
has been opened once following an install or a Force stop.

**Checking it on a phone.** `adb emu sms send VM-HDFCBK "Rs.250.00 debited from A/c XX1234 to SWIGGY on 05-10-26 Ref 628123456789"` sends a test SMS to an emulator. On a real phone,
use a real bank message, or text yourself a bank-style message from another number that includes a currency amount and `A/c XX1234` (a bare "paid 500" is ignored on purpose). With
**Notification access** on, the message is also picked up from your messages app's notification, so it works even when it arrives over RCS. If nothing appears, check that the
account's last digits are saved under Accounts (otherwise it files under the default account and says **Account not matched — check**) and open MyFin once so it can file what it caught.

## Change the app name or application ID

**App name (what appears under the launcher icon)** — edit both places (`npx cap sync` does _not_ update the Android resource):

1. `appName` in [`capacitor.config.ts`](capacitor.config.ts)
2. `app_name` and `title_activity_main` in `android/app/src/main/res/values/strings.xml`

**Application ID** (currently `io.github.akhlaquea01.myfin`). Android identifies an installed app by this ID and ties its data to it, so **changing it installs a separate
app with an empty database** (the old one stays installed). Back up first, and only change it if you have to:

1. `appId` in `capacitor.config.ts`
2. `namespace` and `applicationId` in `android/app/build.gradle`
3. `package_name` and `custom_url_scheme` in `android/app/src/main/res/values/strings.xml`
4. Move `android/app/src/main/java/io/github/akhlaquea01/myfin/MainActivity.java` into the matching new folders and update its `package` line

**Version:** `versionName` is `MAJOR.MINOR` from `package.json` plus the commit count; `versionCode` is the commit count (both set by the workflow and read by
`android/app/build.gradle`) — see [Versions and releases](#versions-and-releases).

**App icon:** the launcher icon is Capacitor's default. To use your own artwork, put a 1024×1024 `assets/icon-only.png` (plus `assets/icon-foreground.png` and
`assets/icon-background.png` for adaptive icons) in the repo and run `npx @capacitor/assets generate --android` once, then commit the generated `android/app/src/main/res/` files.

## Production API URLs and environment variables

MyFin needs **none today**: it is local-first, the web layer makes no network requests, and its Content-Security-Policy (`connect-src 'self'`, set in `vite.config.ts`) forbids them.
The one exception sits outside the web layer: the APK's native update plugin (`android/.../update/NativeAppUpdatePlugin.java`) contacts GitHub when you press **Check for updates**,
as described above; the page cannot reach it with an address of its own. Nothing in `.env` files reaches the build either — they are gitignored, so the cloud build never sees them.

If you add a feature that calls a server:

1. Read it in code as `import.meta.env.VITE_API_URL`. Vite only exposes variables that start with `VITE_`, and inlines them into the bundle **at build time** — so they end up
   readable inside the APK. Never put secrets in them.
2. Provide the value to the build: repository **Settings → Secrets and variables → Actions → Variables**, then add
   `env: { VITE_API_URL: ${{ vars.VITE_API_URL }} }` to the **Build the web app** step of the workflow.
3. Allow the origin in the CSP `connect-src` list in `vite.config.ts`, otherwise the WebView blocks the request. This also breaks the "your data never leaves your device"
   guarantee for that feature, so make it a deliberate decision.
4. The app runs from `https://localhost` inside the APK, so the server must allow that origin in its CORS settings and be reachable over HTTPS (plain `http://` is blocked).

Do not change `server.androidScheme` or the hostname in `capacitor.config.ts`: browser storage is tied to that origin, and changing it would orphan all existing data.

## Checking it locally (optional)

These need only Node, not Android tooling, and prove the web half of the pipeline:

```bash
npm run build -- --mode capacitor
npx cap sync android
```

The Gradle step (turning `android/` into an APK) is deliberately run only by GitHub Actions.

## Troubleshooting

| Symptom                                                                                        | Cause and fix                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow does not start after a push                                                           | Push to `master` (not another branch) with the workflow file at `.github/workflows/build-apk.yml`, and check Actions is enabled. Or start it manually with **Run workflow**.                                                                                                       |
| `npm ci` fails with `EBADENGINE` or "lock file out of sync"                                    | The repo sets `engine-strict=true`, so the workflow's Node major (24) must satisfy every dependency. Run `npm install` locally, commit the updated `package-lock.json`, and keep `node-version` in the workflow in step with your dependencies.                                    |
| `dist/index.html is missing`                                                                   | The web build failed or wrote somewhere else. Read the **Build the web app** log; if you changed Vite's `build.outDir`, change `webDir` in `capacitor.config.ts` and the `dist/` paths in the workflow to match.                                                                   |
| `dist/sw.js exists`                                                                            | The APK build was run without `--mode capacitor`. A bundled service worker would keep serving the previous version's UI after an update.                                                                                                                                           |
| Gradle: "requires Java 21" / `Unsupported class file major version`                            | The **Set up Java 21** step must run before Gradle. Capacitor 8 and Android Gradle Plugin 8.13 need JDK 21.                                                                                                                                                                        |
| `./gradlew: Permission denied`                                                                 | Git lost the executable bit (common when committing from Windows). The **Make the Gradle wrapper executable** step handles it; keep that step.                                                                                                                                     |
| `SDK location not found`, `Failed to install the following SDK components`, or a licence error | The runner image no longer ships Android platform 36 / build-tools 36. Add a pinned `android-actions/setup-android` step after Java setup with `packages: platforms;android-36 build-tools;36.0.0`, or pin `runs-on` to an image version that has them.                            |
| `Keystore was tampered with, or password was incorrect`                                        | `android/app/debug.keystore` was replaced or regenerated with different credentials. It must be a PKCS12 file with alias `androiddebugkey` and password `android` (see `signingConfigs` in `android/app/build.gradle`).                                                            |
| Phone says **App not installed**                                                               | Usually a signature mismatch: the installed copy was signed with another key (an earlier build from before the keystore was committed, or one built elsewhere). Back up in the app, uninstall it, install again. Also caused by a lower version number or too little free storage. |
| Phone shows the old version after installing                                                   | Check Settings → Apps → MyFin for the version. A build with a lower version number (commit count) than the installed one cannot replace it.                                                                                                                                        |
| **App updates** says "No update has been published yet"                                        | No release exists. Push to `master` or run **Build Android APK** on `master`, and check that its **Publish GitHub Release** job passed. The repository must be public.                                                                                                             |
| **App updates** says GitHub is limiting requests                                               | GitHub allows about 60 anonymous API calls per hour per network address. Wait and try again.                                                                                                                                                                                       |
| In-app update ends with "App not installed" or says the update uses a different key            | The installed copy was signed with another key, or is newer than the release. Back up, uninstall, and install the release APK by hand (see "Phone says App not installed" above).                                                                                                  |
| In-app update opens a settings screen instead of the installer                                 | Android needs you to allow MyFin to **install unknown apps** once. Switch on **Allow from this source**, go back to MyFin, and tap **Install**.                                                                                                                                    |
| Blank screen on launch                                                                         | Update **Android System WebView** and Chrome from Google Play (the app needs a current WebView). To see errors, enable USB debugging and open `chrome://inspect` on a PC.                                                                                                          |
| "Save cancelled." when exporting                                                               | You dismissed the share sheet. Run the export again and pick a destination.                                                                                                                                                                                                        |
| A build for an older commit was cancelled                                                      | Expected: the workflow cancels superseded runs on the same branch.                                                                                                                                                                                                                 |
| The signing fingerprint in the run summary changes between builds                              | The shared debug key is not being used. Check that `android/app/debug.keystore` is committed and not ignored (`git check-ignore -v android/app/debug.keystore` should print nothing).                                                                                              |

### About the committed debug keystore

`android/app/debug.keystore` is a standard Android _debug_ key (password `android`). It is intentionally public and not a secret: its only job is to give every build the same
signature so updates install in place. The consequence is that anyone can build an APK that Android will treat as an update to yours, so install only APKs you built or
downloaded from your own workflow runs. It cannot be used to publish to Google Play; if you ever publish, create a separate release keystore and store it as a GitHub
Actions secret.

## If this project were Next.js or server-rendered

MyFin is not — it is a client-only Vite SPA, which is why it packages as a static app with no changes to its architecture. For reference, a Capacitor app is a set of static
files running offline in a WebView, so a server-dependent framework cannot be packaged as-is:

- **Next.js with `output: 'export'`** produces a static site (`out/`); set `webDir: 'out'` and build with `next build`. API routes, middleware, server actions, ISR and
  server-side rendering are not available; the app must use client-side data fetching against a hosted API.
- **Next.js with SSR/API routes** needs a hosted server. Either deploy it and call it from a static client build, or point Capacitor at the deployed site with
  `server: { url: 'https://your-site.example' }` — which turns the APK into a thin shell that needs the network and drops offline use.
- **Create React App** builds to `build/`, so use `webDir: 'build'`. **Vite** builds to `dist/` (as here).
- Single-page apps using the History API (like this one) work as-is: Capacitor serves `index.html` for unknown paths.
