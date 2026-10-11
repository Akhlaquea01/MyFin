# Building the MyFin Android APK

MyFin is a static Vite + React app. [Capacitor](https://capacitorjs.com) wraps the built `dist/` folder in an Android WebView, and a GitHub Actions workflow
([`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml)) compiles it into an installable **debug APK** on a GitHub-hosted Ubuntu runner.
You do not need Android Studio, the Android SDK, or Java on your PC.

```
npm run build -- --mode capacitor   →   dist/
npx cap sync android                →   copies dist/ into android/
./gradlew assembleDebug             →   android/app/build/outputs/apk/debug/app-debug.apk
```

## One-time setup

1. **Commit and push** the Android files to the `master` branch of your GitHub repository: `android/` (including `android/app/debug.keystore`), `capacitor.config.ts`,
   `.github/workflows/build-apk.yml`, and the `package.json` / `package-lock.json` changes.
2. Make sure GitHub Actions is enabled: repository **Settings → Actions → General → Allow all actions** (this is the default).
3. That's it. There are no secrets to configure, and public repositories get free Actions minutes.

## Build the APK

- **Automatically:** every push to `master` starts a build.
- **Manually:** repository **Actions** tab → **Build Android APK** → **Run workflow** → choose the branch → **Run workflow**.

The first run takes roughly 5–10 minutes; later runs are faster because npm and Gradle downloads are cached. When the run finishes, its summary shows the build number and the
signing-certificate fingerprint.

## Download and install

1. Open the finished (green) run and scroll to **Artifacts**. Download **`myfin-debug-apk`** — GitHub delivers it as a `.zip`.
2. Unzip it to get `app-debug.apk`. You can do this on your PC and copy the file to the phone, or open the zip with the phone's Files app.
3. Tap `app-debug.apk` on the phone. Android asks you to allow **Install unknown apps** for the app you opened it from (Files, Chrome, …) — allow it once, then **Install**.
   If Play Protect warns about an unknown developer, choose **Install anyway**: this is a debug build that is not distributed through Google Play.

**Updating:** install a newer APK straight over the old one. Your data is kept, because every build is signed with the same committed debug key and each build has a higher
version number (the run number). Artifacts are kept for 30 days.

> **Back up first.** Uninstalling the app, or clearing its storage, permanently deletes everything in it. Use **Backup** inside MyFin before doing either.

## What is different on Android

- **Export and Backup** open Android's share sheet (Save to Drive, Files, send to another app, …) instead of downloading to a folder. The file is first written to the app's
  private cache. If you dismiss the sheet, MyFin reports "Save cancelled." and no file was saved.
- **Data stays on the device.** The app disables Android's cloud auto-backup (`android:allowBackup="false"`) so your encrypted ledger and session key are never uploaded to a Google
  account. Moving to a new phone therefore works through MyFin's own encrypted Backup → Restore, not through Android's phone-to-phone transfer.
- **Not available or unverified in the APK** (they rely on browser features; MyFin hides or skips them when missing, but check on your phone): biometric unlock (the PIN always
  works), browser notifications, automatic backup to a chosen folder, sharing text/images _into_ MyFin from other apps, and the PWA update prompt (updating is installing a new
  APK). The "browser couldn't guarantee protected storage" banner may appear; it is dismissible, and the advice behind it still holds — take regular Backups.
- The hardware/gesture **Back** button does not step back through MyFin's pages: Capacitor's core has no back-button handling (that is the separate `@capacitor/app` plugin, which
  this project does not include), so Android's default applies and Back leaves the app. Use MyFin's own menu to navigate.

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

**Version:** `versionName` is the `version` in `package.json`; `versionCode` is the workflow run number (set in the workflow and read by `android/app/build.gradle`).

**App icon:** the launcher icon is Capacitor's default. To use your own artwork, put a 1024×1024 `assets/icon-only.png` (plus `assets/icon-foreground.png` and
`assets/icon-background.png` for adaptive icons) in the repo and run `npx @capacitor/assets generate --android` once, then commit the generated `android/app/src/main/res/` files.

## Production API URLs and environment variables

MyFin needs **none today**: it is local-first, makes no network requests, and its Content-Security-Policy (`connect-src 'self'`, set in `vite.config.ts`) forbids them. Nothing
in `.env` files reaches the build either — they are gitignored, so the cloud build never sees them.

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
| Phone shows the old version after installing                                                   | Check Settings → Apps → MyFin for the version. A build with a lower run number than the installed one cannot replace it.                                                                                                                                                           |
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
