package io.github.akhlaquea01.myfin.update;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The decisions behind in-app updates, kept free of Android classes so they run in plain JVM
 * tests: which version is newer, which release file is the app, and which addresses the download
 * may touch.
 *
 * The web layer never supplies an address. The plugin only ever asks the one repository below and
 * only follows redirects to the hosts below, so script running in the WebView cannot point it at
 * some other APK.
 */
final class UpdateRules {
    private UpdateRules() {}

    /** The repository that publishes MyFin releases (see .github/workflows/build-apk.yml). */
    static final String RELEASES_URL = "https://api.github.com/repos/Akhlaquea01/MyFin/releases/latest";

    /** A release asset must live under this release-download path. */
    private static final String DOWNLOAD_PREFIX = "https://github.com/Akhlaquea01/MyFin/releases/download/";

    /**
     * Where GitHub may redirect a release download to. Exact hosts, not "*.githubusercontent.com":
     * that domain also serves raw files that anyone can publish.
     */
    private static final String[] REDIRECT_HOSTS = {
        "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"
    };

    /** The file name the build gives the APK: MyFin-v0.1.93.apk. */
    private static final Pattern APK_NAME = Pattern.compile("MyFin-v(\\d{1,6}\\.\\d{1,6}\\.\\d{1,6})\\.apk");

    private static final Pattern VERSION = Pattern.compile("[vV]?(\\d{1,6})(?:\\.(\\d{1,6}))?(?:\\.(\\d{1,6}))?");

    private static final Pattern SHA256_DIGEST = Pattern.compile("sha256:([0-9a-fA-F]{64})");

    /** {@code "v0.1.93"} or {@code "0.1"} as {major, minor, patch}; null when it is not a version. */
    static int[] parseVersion(String text) {
        if (text == null) return null;
        Matcher m = VERSION.matcher(text.trim());
        if (!m.matches()) return null;
        return new int[] {
            Integer.parseInt(m.group(1)),
            m.group(2) == null ? 0 : Integer.parseInt(m.group(2)),
            m.group(3) == null ? 0 : Integer.parseInt(m.group(3))
        };
    }

    /** True when {@code candidate} is a higher version than {@code installed}. Unreadable means no. */
    static boolean isNewer(String candidate, String installed) {
        int[] a = parseVersion(candidate);
        int[] b = parseVersion(installed);
        if (a == null || b == null) return false;
        for (int i = 0; i < 3; i++) {
            if (a[i] != b[i]) return a[i] > b[i];
        }
        return false;
    }

    /** {@code "v0.1.93"} to {@code "0.1.93"}; null when it is not a full x.y.z version. */
    static String normalizeTag(String tag) {
        if (tag == null) return null;
        Matcher m = VERSION.matcher(tag.trim());
        if (!m.matches() || m.group(2) == null || m.group(3) == null) return null;
        return Integer.parseInt(m.group(1)) + "." + Integer.parseInt(m.group(2)) + "." + Integer.parseInt(m.group(3));
    }

    /** Whether a release file is the app's APK for exactly this version. */
    static boolean isApkFor(String assetName, String version) {
        if (assetName == null || version == null) return false;
        Matcher m = APK_NAME.matcher(assetName);
        return m.matches() && m.group(1).equals(version);
    }

    /** {@code "MyFin-v0.1.93.apk"} to {@code "0.1.93"}; null for any other file name. */
    static String versionOfApkName(String assetName) {
        if (assetName == null) return null;
        Matcher m = APK_NAME.matcher(assetName);
        return m.matches() ? m.group(1) : null;
    }

    /** The first request must be a download from this repository's releases, over HTTPS. */
    static boolean isTrustedAssetUrl(String url) {
        return url != null && url.startsWith(DOWNLOAD_PREFIX) && !url.contains("..") && hostOf(url) != null;
    }

    /** A redirect target is followed only when it is HTTPS on one of the hosts GitHub serves files from. */
    static boolean isTrustedRedirect(String url) {
        String host = hostOf(url);
        if (host == null) return false;
        for (String allowed : REDIRECT_HOSTS) {
            if (allowed.equals(host)) return true;
        }
        return false;
    }

    private static String hostOf(String url) {
        if (url == null) return null;
        try {
            URI uri = new URI(url);
            if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null) return null;
            if (uri.getPort() != -1 && uri.getPort() != 443) return null;
            String host = uri.getHost();
            return host == null ? null : host.toLowerCase(Locale.ROOT);
        } catch (URISyntaxException e) {
            return null;
        }
    }

    /** GitHub's {@code "sha256:<hex>"} asset digest as lowercase hex; null when absent or another kind. */
    static String sha256FromDigest(String digest) {
        if (digest == null) return null;
        Matcher m = SHA256_DIGEST.matcher(digest.trim());
        return m.matches() ? m.group(1).toLowerCase(Locale.ROOT) : null;
    }

    static String toHex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            out.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
        }
        return out.toString();
    }

    /** Release notes are shown in a small card; keep them short and free of control characters. */
    static String tidyNotes(String notes, int maxChars) {
        if (notes == null) return "";
        String cleaned = notes.replace("\r\n", "\n").replaceAll("[\\p{Cntrl}&&[^\n]]", "").trim();
        if (cleaned.length() <= maxChars) return cleaned;
        return cleaned.substring(0, maxChars).trim() + "…";
    }
}
