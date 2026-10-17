package io.github.akhlaquea01.myfin.update;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Updates MyFin from its own GitHub Releases: check for a newer version, download the APK, hand it
 * to Android's installer. Every build from master is published there as MyFin-vX.Y.Z.apk (see
 * .github/workflows/build-apk.yml).
 *
 * The network lives here, not in the web layer, on purpose: the WebView's Content-Security-Policy
 * stays at {@code connect-src 'self'}, so nothing running in the page can send data anywhere. The
 * web layer cannot supply an address either. {@code check()} asks one fixed repository, remembers
 * the file it found, and {@code download()} / {@code install()} act only on that remembered file.
 *
 * Nothing runs by itself: every request here starts from the user pressing a button on the About
 * page, and the only things GitHub learns are the phone's IP address and a generic user agent.
 *
 * Android always asks the user to confirm the install; an app cannot update itself silently.
 */
@CapacitorPlugin(name = "NativeAppUpdate")
public class NativeAppUpdatePlugin extends Plugin {
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final String UPDATES_DIR = "updates";

    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;
    private static final int MAX_REDIRECTS = 5;
    private static final int MAX_JSON_BYTES = 1024 * 1024;
    /** The app is a few MB; anything this large is not it. */
    private static final long MAX_APK_BYTES = 200L * 1024L * 1024L;
    private static final int MAX_NOTES_CHARS = 1500;
    private static final long PROGRESS_INTERVAL_MS = 250;

    /** What {@code check()} found and {@code download()} will fetch. */
    private static final class Release {
        final String version;
        final String assetUrl;
        final long size;
        final String sha256;

        Release(String version, String assetUrl, long size, String sha256) {
            this.version = version;
            this.assetUrl = assetUrl;
            this.size = size;
            this.sha256 = sha256;
        }
    }

    /** A failure the web layer can tell apart by {@code code}. */
    private static final class UpdateException extends Exception {
        final String code;

        UpdateException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    private volatile Release release;
    private volatile File downloaded;
    private final AtomicBoolean checking = new AtomicBoolean(false);
    private final AtomicBoolean downloading = new AtomicBoolean(false);

    /**
     * Clears what earlier runs left behind: half-finished downloads, and APKs that are no newer
     * than what is installed (they were installed, or are stale). A newer APK stays: Android can
     * restart the app when the user allows "Install unknown apps" for it, and the download should
     * survive that.
     */
    @Override
    public void load() {
        new Thread(() -> {
            File[] files = updatesDir().listFiles();
            if (files == null) return;
            String installed;
            try {
                installed = installedVersionName();
            } catch (UpdateException e) {
                return;
            }
            for (File file : files) {
                String version = UpdateRules.versionOfApkName(file.getName());
                if (version == null || !UpdateRules.isNewer(version, installed)) deleteFile(file);
            }
        }).start();
    }

    /**
     * Asks GitHub for the newest release. Resolves {@code {installedVersion, latestVersion,
     * updateAvailable, size, notes, publishedAt}}. Rejects with a code: "offline", "no-release",
     * "rate-limited", "bad-response", "no-asset", "busy".
     */
    @PluginMethod
    public void check(PluginCall call) {
        if (!checking.compareAndSet(false, true)) {
            call.reject("An update check is already running.", "busy");
            return;
        }
        new Thread(() -> {
            try {
                call.resolve(runCheck());
            } catch (UpdateException e) {
                call.reject(e.getMessage(), e.code);
            } catch (RuntimeException e) {
                call.reject("The update check failed.", "bad-response");
            } finally {
                checking.set(false);
            }
        }).start();
    }

    private JSObject runCheck() throws UpdateException {
        String installed = installedVersionName();
        JSONObject json = fetchLatestRelease();
        String latest = UpdateRules.normalizeTag(json.optString("tag_name", ""));
        if (latest == null) throw new UpdateException("bad-response", "The latest release has no version.");

        boolean newer = UpdateRules.isNewer(latest, installed);
        Release found = null;
        if (newer) found = findAsset(json, latest);

        release = found;
        downloaded = null;

        JSObject result = new JSObject();
        result.put("installedVersion", installed);
        result.put("latestVersion", latest);
        result.put("updateAvailable", newer);
        result.put("size", found == null ? 0L : found.size);
        result.put("notes", UpdateRules.tidyNotes(json.isNull("body") ? "" : json.optString("body", ""), MAX_NOTES_CHARS));
        result.put("publishedAt", json.optString("published_at", ""));
        return result;
    }

    private static Release findAsset(JSONObject json, String version) throws UpdateException {
        JSONArray assets = json.optJSONArray("assets");
        if (assets != null) {
            for (int i = 0; i < assets.length(); i++) {
                JSONObject asset = assets.optJSONObject(i);
                if (asset == null) continue;
                String name = asset.optString("name", "");
                String url = asset.optString("browser_download_url", "");
                if (!UpdateRules.isApkFor(name, version) || !UpdateRules.isTrustedAssetUrl(url)) continue;
                return new Release(version, url, asset.optLong("size", 0L),
                        UpdateRules.sha256FromDigest(asset.isNull("digest") ? null : asset.optString("digest", null)));
            }
        }
        throw new UpdateException("no-asset", "Version " + version + " has no APK to download.");
    }

    private JSONObject fetchLatestRelease() throws UpdateException {
        HttpURLConnection connection = null;
        try {
            connection = open(UpdateRules.RELEASES_URL);
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
            int status = connection.getResponseCode();
            if (status == 404) throw new UpdateException("no-release", "No release has been published yet.");
            if (status == 403 || status == 429) {
                throw new UpdateException("rate-limited", "GitHub is limiting requests right now. Try again later.");
            }
            if (status != 200) throw new UpdateException("bad-response", "GitHub answered " + status + ".");
            return new JSONObject(readText(connection.getInputStream()));
        } catch (JSONException e) {
            throw new UpdateException("bad-response", "GitHub's answer could not be read.");
        } catch (UnknownHostException | SocketTimeoutException e) {
            throw new UpdateException("offline", "Could not reach GitHub.");
        } catch (IOException e) {
            throw new UpdateException("offline", "Could not reach GitHub: " + e.getMessage());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /**
     * Downloads the APK that {@code check()} found and verifies it before it is offered to the
     * installer. Emits {@code progress} events {@code {received, total}}. Resolves {@code
     * {version}}. Rejects with a code: "not-checked", "busy", "offline", "download-failed",
     * "checksum", "wrong-app", "not-newer", "signature".
     */
    @PluginMethod
    public void download(PluginCall call) {
        Release target = release;
        if (target == null) {
            call.reject("Check for updates first.", "not-checked");
            return;
        }
        if (!downloading.compareAndSet(false, true)) {
            call.reject("A download is already running.", "busy");
            return;
        }
        new Thread(() -> {
            try {
                downloaded = null;
                File apk = fetchAndVerify(target);
                downloaded = apk;
                JSObject result = new JSObject();
                result.put("version", target.version);
                call.resolve(result);
            } catch (UpdateException e) {
                call.reject(e.getMessage(), e.code);
            } catch (RuntimeException e) {
                call.reject("The download failed.", "download-failed");
            } finally {
                downloading.set(false);
            }
        }).start();
    }

    private File fetchAndVerify(Release target) throws UpdateException {
        File dir = updatesDir();
        String fileName = "MyFin-v" + target.version + ".apk";
        File part = new File(dir, fileName + ".part");
        File apk = new File(dir, fileName);

        // Already downloaded and still intact (a second tap, or the app was restarted): reuse it.
        if (apk.isFile() && isIntact(apk, target)) {
            try {
                checkIsTheNextVersionOfThisApp(apk, target.version);
                emitProgress(apk.length(), apk.length());
                return apk;
            } catch (UpdateException e) {
                // Fall through and download it again.
            }
        }
        deleteContents(dir);
        if (!dir.isDirectory() && !dir.mkdirs()) {
            throw new UpdateException("download-failed", "Could not prepare a place to save the update.");
        }

        HttpURLConnection connection = null;
        try {
            connection = openAsset(target.assetUrl);
            long total = target.size > 0 ? target.size : connection.getContentLengthLong();
            MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
            long received = 0;
            long lastEmit = 0;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buffer = new byte[32 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) {
                    received += read;
                    if (received > MAX_APK_BYTES || (target.size > 0 && received > target.size)) {
                        throw new UpdateException("download-failed", "The file is larger than expected.");
                    }
                    out.write(buffer, 0, read);
                    sha256.update(buffer, 0, read);
                    long now = System.currentTimeMillis();
                    if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
                        lastEmit = now;
                        emitProgress(received, total);
                    }
                }
            }
            emitProgress(received, total);

            if (target.size > 0 && received != target.size) {
                throw new UpdateException("download-failed", "The download was cut short.");
            }
            if (target.sha256 != null && !target.sha256.equals(UpdateRules.toHex(sha256.digest()))) {
                throw new UpdateException("checksum", "The downloaded file does not match GitHub's checksum.");
            }
            if (!part.renameTo(apk)) {
                throw new UpdateException("download-failed", "Could not save the update.");
            }
            checkIsTheNextVersionOfThisApp(apk, target.version);
            return apk;
        } catch (UpdateException e) {
            deleteContents(dir);
            throw e;
        } catch (UnknownHostException | SocketTimeoutException e) {
            deleteContents(dir);
            throw new UpdateException("offline", "The connection dropped during the download.");
        } catch (IOException | NoSuchAlgorithmException e) {
            deleteContents(dir);
            throw new UpdateException("download-failed", "The download failed: " + e.getMessage());
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /**
     * Android refuses a wrong update at install time with a bare "App not installed". Checking the
     * same things first lets MyFin say why: it is this app, it is the release it claims to be, it
     * is newer, and it is signed by the key that signed the installed copy.
     */
    @SuppressWarnings("deprecation")
    private void checkIsTheNextVersionOfThisApp(File apk, String expectedVersion) throws UpdateException {
        Context context = getContext();
        PackageManager packages = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES;
        PackageInfo offered = packages.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (offered == null) throw new UpdateException("wrong-app", "The downloaded file is not a valid app.");
        if (!context.getPackageName().equals(offered.packageName)) {
            throw new UpdateException("wrong-app", "The downloaded file is a different app.");
        }
        if (!expectedVersion.equals(offered.versionName)) {
            throw new UpdateException("wrong-app", "The downloaded file is not version " + expectedVersion + ".");
        }
        try {
            PackageInfo installed = packages.getPackageInfo(context.getPackageName(), flags);
            if (PackageInfoCompat.getLongVersionCode(offered) <= PackageInfoCompat.getLongVersionCode(installed)) {
                throw new UpdateException("not-newer", "The downloaded file is not newer than the installed app.");
            }
            Set<String> offeredSigners = signerHashes(offered);
            Set<String> installedSigners = signerHashes(installed);
            // Older Android versions cannot always read an APK's signer before it is installed; in
            // that case Android's own check at install time still applies.
            if (!offeredSigners.isEmpty() && !installedSigners.isEmpty() && !offeredSigners.equals(installedSigners)) {
                throw new UpdateException("signature",
                        "The update is signed with a different key, so Android would refuse it over this install.");
            }
        } catch (PackageManager.NameNotFoundException e) {
            throw new UpdateException("wrong-app", "MyFin could not read its own install.");
        }
    }

    @SuppressWarnings("deprecation")
    private static Set<String> signerHashes(PackageInfo info) {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28) {
            SigningInfo signing = info.signingInfo;
            signatures = signing == null ? null : signing.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        Set<String> hashes = new HashSet<>();
        if (signatures == null) return hashes;
        try {
            for (Signature signature : signatures) {
                hashes.add(UpdateRules.toHex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
            }
        } catch (NoSuchAlgorithmException e) {
            hashes.clear();
        }
        return hashes;
    }

    /**
     * Opens Android's installer on the downloaded file. Resolves {@code {status}}: "started" (the
     * system confirmation is showing) or "permission-needed" (Android's "Install unknown apps"
     * screen for MyFin was opened; the user comes back and asks again). Rejects with a code:
     * "not-downloaded", "install-failed".
     */
    @PluginMethod
    public void install(PluginCall call) {
        File apk = downloaded;
        if (apk == null || !apk.isFile()) {
            call.reject("Download the update first.", "not-downloaded");
            return;
        }
        Context context = getContext();
        JSObject result = new JSObject();
        try {
            if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) {
                Intent settings = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(settings);
                result.put("status", "permission-needed");
                call.resolve(result);
                return;
            }
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, APK_MIME);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            result.put("status", "started");
            call.resolve(result);
        } catch (ActivityNotFoundException | IllegalArgumentException e) {
            call.reject("Android could not open the installer.", "install-failed");
        }
    }

    // --- helpers ---------------------------------------------------------------------------

    private void emitProgress(long received, long total) {
        JSObject progress = new JSObject();
        progress.put("received", received);
        progress.put("total", total);
        notifyListeners("progress", progress);
    }

    private File updatesDir() {
        return new File(getContext().getCacheDir(), UPDATES_DIR);
    }

    private static void deleteContents(File dir) {
        File[] files = dir.listFiles();
        if (files == null) return;
        // Not recursive on purpose: this folder only ever holds the files written above.
        for (File file : files) deleteFile(file);
    }

    private static void deleteFile(File file) {
        if (file.isFile() && !file.delete()) {
            // Best effort: a file that cannot be removed now is retried at the next launch.
            file.deleteOnExit();
        }
    }

    /** The file on disk is the size and checksum GitHub published for it. */
    private static boolean isIntact(File apk, Release target) {
        if (target.size > 0 && apk.length() != target.size) return false;
        if (target.sha256 == null) return target.size > 0;
        try (InputStream in = new FileInputStream(apk)) {
            MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) sha256.update(buffer, 0, read);
            return target.sha256.equals(UpdateRules.toHex(sha256.digest()));
        } catch (IOException | NoSuchAlgorithmException e) {
            return false;
        }
    }

    @SuppressWarnings("deprecation")
    private String installedVersionName() throws UpdateException {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            return info.versionName == null ? "" : info.versionName;
        } catch (PackageManager.NameNotFoundException e) {
            throw new UpdateException("bad-response", "MyFin could not read its own version.");
        }
    }

    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        // Redirects are followed by hand so every hop can be checked against the allowed hosts.
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("User-Agent", "MyFin-Android-Updater");
        return connection;
    }

    /** Connects to the release file, following GitHub's redirect to its file host. */
    private static HttpURLConnection openAsset(String assetUrl) throws IOException, UpdateException {
        String url = assetUrl;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            HttpURLConnection connection = open(url);
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new UpdateException("download-failed", "GitHub sent an empty redirect.");
                String next = new URL(new URL(url), location).toString();
                if (!UpdateRules.isTrustedRedirect(next)) {
                    throw new UpdateException("download-failed", "GitHub redirected to an unexpected address.");
                }
                url = next;
                continue;
            }
            if (status != 200) {
                connection.disconnect();
                throw new UpdateException("download-failed", "GitHub answered " + status + " for the file.");
            }
            return connection;
        }
        throw new UpdateException("download-failed", "Too many redirects.");
    }

    private static String readText(InputStream in) throws IOException {
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8 * 1024];
            int read;
            while ((read = stream.read(buffer)) != -1) {
                if (out.size() + read > MAX_JSON_BYTES) throw new IOException("The answer is too large.");
                out.write(buffer, 0, read);
            }
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }
}
