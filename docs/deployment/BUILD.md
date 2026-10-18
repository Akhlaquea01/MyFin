# Build, release and deployment

MyFin ships in two forms from one code base: a **static web app / PWA** and a **signed debug APK**
built by GitHub Actions. This guide covers both. Day-to-day commands are in
[SETUP](../development/SETUP.md); CI is described in [TESTING](../testing/TESTING.md#continuous-integration);
what behaves differently on Android is in [Android app](../product/ANDROID_APP.md); fixes for
failures are in [TROUBLESHOOTING](../maintenance/TROUBLESHOOTING.md).

**Contents:** [Web build](#web-build-pwa) · [Android APK](#android-apk) · [Versions and releases](#versions-and-releases) · [Installing a build](#installing-a-build) · [Configuration and environment variables](#configuration-and-environment-variables) · [Checking locally](#checking-locally) · [Signing key](#signing-key) · [Changing the app's identity](#changing-the-apps-identity)

---

## Web build (PWA)

```bash
npm run build      # tsc -b, then vite build → dist/
npm run preview    # serves dist/ at http://localhost:4173
```

`dist/` is a plain static site: `index.html` (with the Content-Security-Policy injected as a `<meta>`
tag at build time), hashed JS/CSS in `assets/`, `manifest.webmanifest`, the Workbox service worker
(`sw.js`, `workbox-*.js`), `sw-share-target.js`, icons and `robots.txt`.

**Hosting requirements** — any static host works (the app needs no server; project policy is free and
open-source hosting such as GitHub Pages, Netlify or Vercel):

- **HTTPS** (or `localhost`). Service workers and Web Crypto require a secure context.
- **Single-page fallback**: unknown paths such as `/transactions` or `/share-target-landing` must
  return `index.html`, because routing uses the History API (`BrowserRouter`).
- **Serve `sw.js` and `index.html` without long-lived caching**, so a new release reaches users; the
  hashed files under `assets/` can be cached indefinitely.
- **`frame-ancestors`** cannot be set from a `<meta>` tag. If clickjacking protection matters, have the
  host send `Content-Security-Policy: frame-ancestors 'none'` (or `X-Frame-Options: DENY`) as a
  response header.
- Deploy the whole of `dist/` at the site root: the manifest, `start_url`, share target and service
  worker scopes all assume `/`.

The CSP (`default-src 'self'`, `connect-src 'self'`, no inline script) is set in `vite.config.ts`
(`cspPlugin`) and applies to **production builds only**: the dev server's React Refresh preamble is an
inline script that the policy would block.

The repository contains no host-specific deployment configuration; it is a deliberate choice that the
build is host-agnostic.

---

## Android APK

[Capacitor](https://capacitorjs.com) wraps the built `dist/` folder in an Android WebView, and the
GitHub Actions workflow [`build-apk.yml`](../../.github/workflows/build-apk.yml) compiles it into an
installable **debug APK** on a GitHub-hosted Ubuntu runner. You do not need Android Studio, the Android
SDK or Java on your PC. Every build from `master` is also published as a **GitHub Release**
(`MyFin-vX.Y.Z.apk`), and the app can check that release and install it itself
(**About → App updates**).

```text
npm run build -- --mode capacitor   →   dist/      (web bundle, PWA service worker switched off)
npx cap sync android                →   copies dist/ into android/
./gradlew assembleDebug             →   android/app/build/outputs/apk/debug/app-debug.apk
```

### Repository prerequisites

1. The workflow's inputs are in the repository: `android/` (including `android/app/debug.keystore`),
   `capacitor.config.ts`, `.github/workflows/build-apk.yml`, `package.json` and `package-lock.json`.
2. GitHub Actions is enabled: **Settings → Actions → General → Allow all actions** (the default).
3. There are **no secrets** to configure; public repositories get free Actions minutes. The release job
   uses the workflow's own token (`contents: write`; the build job stays read-only). If it fails with
   "Resource not accessible by integration", check **Settings → Actions → General → Workflow
   permissions** and that no organisation policy blocks write tokens.
4. The repository must stay **public**: the app downloads updates from the release without a login.
   For a private repository the update check would get a 404.

### Building

- **Automatically:** every push to `master` starts a build.
- **Manually:** **Actions** tab → **Build Android APK** → **Run workflow** → choose the branch.

The first run takes roughly 5–10 minutes; later runs are faster because npm and Gradle downloads are
cached. The run summary shows the version, the build number and the signing-certificate fingerprint.

What the workflow does, in order: work out the version → set up Node 24 and Java 21 → `npm ci` →
`npm run build -- --mode capacitor` and verify `dist/index.html` exists and `dist/sw.js` does **not** →
`npx cap sync android` and verify the assets were copied → `chmod +x android/gradlew` →
`./gradlew testDebugUnitTest assembleDebug` → verify the APK (signature, `versionCode`/`versionName`
via `aapt2`) → upload it as the `myfin-debug-apk` artifact (30 days) → on `master`, publish a GitHub
Release. All third-party actions are pinned to commit SHAs.

---

## Versions and releases

Every build gets a new, higher version without anyone editing a file:

- **Version** = `MAJOR.MINOR` from `version` in `package.json` + the **number of commits** as the
  patch. With `"version": "0.1.0"` and 93 commits the build is **0.1.93**, the file is
  `MyFin-v0.1.93.apk` and the release is tagged `v0.1.93`. To start a new line (for example `0.2`),
  change `package.json` to `0.2.0`; its patch number is ignored.
- **`versionCode`** (the integer Android compares) is the same commit count. It only ever goes up,
  which is what lets each APK install over the last. **Rewriting `master`'s history so the commit
  count drops would make Android refuse the next update.**
- **Release notes** are the commit subjects since the previous release. Only the newest commit on
  `master` is published (re-running an old workflow never creates a release), and a re-run of the same
  commit replaces the file in its release instead of failing.
- Nothing is committed back by CI, so there are no version-bump commits to merge. A local
  `npm run dev` shows the `package.json` version (`0.1.0`); the APK shows the CI one
  (`APP_VERSION`, read by `vite.config.ts`).

---

## Installing a build

**Easiest — from the phone:** open <https://github.com/Akhlaquea01/MyFin/releases/latest> and tap
`MyFin-vX.Y.Z.apk`. No login and no unzipping.

**Inside the app** (once a build with this feature is installed): **Settings → About → App updates →
Check for updates**. If a newer version is published it shows the version, size and notes; **Download
and install** fetches it, checks it, and opens Android's installer. The first time, Android sends you
to a screen to allow MyFin to **install unknown apps** — switch it on, go back, and tap **Install**.
Android always asks you to confirm; an app cannot update itself silently. Your data stays.

**From a workflow run:** open the finished (green) run, scroll to **Artifacts**, download
**`myfin-debug-apk`** (GitHub delivers it as a `.zip`), unzip it, copy the APK to the phone and open it.
Allow **Install unknown apps** for the app you opened it from, then **Install**. If Play Protect warns
about an unknown developer, choose **Install anyway**: this is a debug build that is not distributed
through Google Play.

**Updating:** install a newer APK straight over the old one. Your data is kept, because every build is
signed with the same committed debug key and each build has a higher version number. Run artifacts are
kept for 30 days; releases until you delete them. A phone that has a build from before in-app updates
needs one manual install of a newer APK first.

> **Back up first.** Uninstalling the app, or clearing its storage, permanently deletes everything in
> it. Use **Backup** inside MyFin before doing either.

---

## Configuration and environment variables

MyFin needs **none today**: it is local-first, the web layer sends nothing to any other origin, and its
Content-Security-Policy (`connect-src 'self'`) forbids it. The one exception sits outside the web
layer: the APK's native update plugin (`android/.../update/NativeAppUpdatePlugin.java`) contacts GitHub
when you press **Check for updates**; the page cannot reach it with an address of its own. `.env` files
are gitignored, so the cloud build never sees them.

If you add a feature that calls a server (this ends the "your data never leaves your device"
guarantee for that feature, so make it a deliberate decision):

1. Read the address in code as `import.meta.env.VITE_API_URL`. Vite exposes only `VITE_`-prefixed
   variables and inlines them into the bundle **at build time**, so they are readable inside the APK.
   Never put secrets in them.
2. Provide the value to the build: **Settings → Secrets and variables → Actions → Variables**, then add
   `env: { VITE_API_URL: ${{ vars.VITE_API_URL }} }` to the **Build the web app** step of the workflow.
3. Allow the origin in the CSP `connect-src` list in `vite.config.ts`, otherwise the WebView blocks it.
4. Inside the APK the app runs from `https://localhost`, so the server must allow that origin in its
   CORS settings and be reachable over HTTPS (plain `http://` is blocked).

Do not change `server.androidScheme` or the hostname in `capacitor.config.ts`: browser storage is tied
to that origin, and changing it would orphan all existing data.

---

## Checking locally

These need only Node, not Android tooling, and prove the web half of the pipeline:

```bash
npm run build -- --mode capacitor
npx cap sync android
```

Afterwards `dist/sw.js` must not exist and `android/app/src/main/assets/public/index.html` must.
`cap sync` regenerates ignored files under `android/` (`app/src/main/assets/`,
`capacitor-cordova-android-plugins/`, `res/xml/config.xml`) and should leave the tracked
`capacitor.build.gradle` and `capacitor.settings.gradle` unchanged. The Gradle step is deliberately run
only by GitHub Actions.

---

## Signing key

`android/app/debug.keystore` is a standard Android _debug_ key (PKCS12, alias `androiddebugkey`,
password `android`). It is intentionally public and not a secret: its only job is to give every build
the same signature so updates install in place. The consequence is that anyone can build an APK that
Android will treat as an update to yours, so install only APKs you built or downloaded from your own
workflow runs. It cannot be used to publish to Google Play; if you ever publish, create a separate
release keystore and store it as a GitHub Actions secret.

It must stay tracked: `git check-ignore -v android/app/debug.keystore` should print nothing.

---

## Changing the app's identity

**App name** (what appears under the launcher icon) — edit both places; `npx cap sync` does _not_
update the Android resource:

1. `appName` in [`capacitor.config.ts`](../../capacitor.config.ts)
2. `app_name` and `title_activity_main` in `android/app/src/main/res/values/strings.xml`

**Application ID** (currently `io.github.akhlaquea01.myfin`). Android ties an installed app's data to
this ID, so **changing it installs a separate app with an empty database** (the old one stays
installed). Back up first, and only change it if you have to:

1. `appId` in `capacitor.config.ts`
2. `namespace` and `applicationId` in `android/app/build.gradle`
3. `package_name` and `custom_url_scheme` in `android/app/src/main/res/values/strings.xml`
4. Move the Java sources under `android/app/src/main/java/io/github/akhlaquea01/myfin/` into the
   matching new folders and update their `package` lines

**Version:** `versionName` and `versionCode` are set by the workflow and read by
`android/app/build.gradle` (see [Versions and releases](#versions-and-releases)).

**App icon:** the launcher icon is Capacitor's default. To use your own artwork, put a 1024×1024
`assets/icon-only.png` (plus `assets/icon-foreground.png` and `assets/icon-background.png` for adaptive
icons) in the repo and run `npx @capacitor/assets generate --android` once, then commit the generated
`android/app/src/main/res/` files.
