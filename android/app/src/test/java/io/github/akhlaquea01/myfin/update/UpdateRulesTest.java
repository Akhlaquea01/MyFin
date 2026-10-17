package io.github.akhlaquea01.myfin.update;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Pins the rules that decide whether the app offers, downloads and installs an update: a wrong
 * answer here either hides a real update or lets an unexpected file through.
 */
public class UpdateRulesTest {
    @Test
    public void versionsAreComparedNumberByNumberNotAsText() {
        assertTrue(UpdateRules.isNewer("v0.1.100", "0.1.99"));
        assertTrue(UpdateRules.isNewer("0.2.0", "0.1.250"));
        assertTrue(UpdateRules.isNewer("1.0.0", "0.9.9"));
        assertFalse(UpdateRules.isNewer("0.1.99", "0.1.100"));
        assertFalse(UpdateRules.isNewer("0.1.99", "0.1.99"));
        assertFalse(UpdateRules.isNewer("v0.1.99", "0.1.99"));
    }

    @Test
    public void anUnreadableVersionNeverCountsAsNewer() {
        assertFalse(UpdateRules.isNewer("nightly", "0.1.1"));
        assertFalse(UpdateRules.isNewer("0.1.2", "unknown"));
        assertFalse(UpdateRules.isNewer(null, "0.1.1"));
        assertFalse(UpdateRules.isNewer("0.1.2", null));
        assertFalse(UpdateRules.isNewer("0.1.2-beta", "0.1.1"));
    }

    @Test
    public void aLocalBuildWithTheDefaultVersionIsNeverOfferedAnUpdate() {
        // Gradle's default versionName is "1.0" when CI did not pass one.
        assertFalse(UpdateRules.isNewer("0.1.93", "1.0"));
        assertArrayEquals(new int[] {1, 0, 0}, UpdateRules.parseVersion("1.0"));
    }

    @Test
    public void tagsBecomeFullVersionsOrNothing() {
        assertEquals("0.1.93", UpdateRules.normalizeTag("v0.1.93"));
        assertEquals("0.1.93", UpdateRules.normalizeTag(" 0.1.93 "));
        assertNull(UpdateRules.normalizeTag("v0.1"));
        assertNull(UpdateRules.normalizeTag("latest"));
        assertNull(UpdateRules.normalizeTag(null));
    }

    @Test
    public void onlyTheAppsOwnApkForThatVersionIsAccepted() {
        assertTrue(UpdateRules.isApkFor("MyFin-v0.1.93.apk", "0.1.93"));
        assertFalse(UpdateRules.isApkFor("MyFin-v0.1.93.apk", "0.1.94"));
        assertFalse(UpdateRules.isApkFor("MyFin-v0.1.93.apk.zip", "0.1.93"));
        assertFalse(UpdateRules.isApkFor("other-v0.1.93.apk", "0.1.93"));
        assertFalse(UpdateRules.isApkFor("../MyFin-v0.1.93.apk", "0.1.93"));
        assertFalse(UpdateRules.isApkFor(null, "0.1.93"));
    }

    @Test
    public void theVersionIsReadBackFromTheApkFileName() {
        assertEquals("0.1.93", UpdateRules.versionOfApkName("MyFin-v0.1.93.apk"));
        assertNull(UpdateRules.versionOfApkName("MyFin-v0.1.93.apk.part"));
        assertNull(UpdateRules.versionOfApkName("notes.txt"));
        assertNull(UpdateRules.versionOfApkName(null));
    }

    @Test
    public void theDownloadMustComeFromThisRepositorysReleases() {
        assertTrue(UpdateRules.isTrustedAssetUrl(
                "https://github.com/Akhlaquea01/MyFin/releases/download/v0.1.93/MyFin-v0.1.93.apk"));
        assertFalse(UpdateRules.isTrustedAssetUrl(
                "http://github.com/Akhlaquea01/MyFin/releases/download/v0.1.93/MyFin-v0.1.93.apk"));
        assertFalse(UpdateRules.isTrustedAssetUrl(
                "https://github.com/someone-else/MyFin/releases/download/v0.1.93/MyFin-v0.1.93.apk"));
        assertFalse(UpdateRules.isTrustedAssetUrl(
                "https://github.com.evil.example/Akhlaquea01/MyFin/releases/download/v1/MyFin-v0.1.93.apk"));
        assertFalse(UpdateRules.isTrustedAssetUrl(
                "https://github.com/Akhlaquea01/MyFin/releases/download/../../../evil.apk"));
        assertFalse(UpdateRules.isTrustedAssetUrl(null));
    }

    @Test
    public void redirectsAreFollowedOnlyToTheHostsGitHubServesFilesFrom() {
        assertTrue(UpdateRules.isTrustedRedirect("https://objects.githubusercontent.com/github-production/abc"));
        assertTrue(UpdateRules.isTrustedRedirect("https://release-assets.githubusercontent.com/github-production/abc"));
        assertTrue(UpdateRules.isTrustedRedirect("https://github.com/Akhlaquea01/MyFin/releases/download/v1/x.apk"));
        assertFalse(UpdateRules.isTrustedRedirect("http://objects.githubusercontent.com/abc"));
        assertFalse(UpdateRules.isTrustedRedirect("https://raw.githubusercontent.com/someone/repo/main/x.apk"));
        assertFalse(UpdateRules.isTrustedRedirect("https://evil.example/objects.githubusercontent.com"));
        assertFalse(UpdateRules.isTrustedRedirect("https://objects.githubusercontent.com@evil.example/abc"));
        assertFalse(UpdateRules.isTrustedRedirect("https://objects.githubusercontent.com:8443/abc"));
        assertFalse(UpdateRules.isTrustedRedirect("not a url"));
        assertFalse(UpdateRules.isTrustedRedirect(null));
    }

    @Test
    public void onlyASha256DigestIsUsedForTheIntegrityCheck() {
        String hex = "ab".repeat(32);
        assertEquals(hex, UpdateRules.sha256FromDigest("sha256:" + hex));
        assertEquals(hex, UpdateRules.sha256FromDigest("sha256:" + hex.toUpperCase()));
        assertNull(UpdateRules.sha256FromDigest("sha1:" + "ab".repeat(20)));
        assertNull(UpdateRules.sha256FromDigest("sha256:short"));
        assertNull(UpdateRules.sha256FromDigest(null));
    }

    @Test
    public void bytesBecomeLowercaseHex() {
        assertEquals("00ff10a5", UpdateRules.toHex(new byte[] {0x00, (byte) 0xff, 0x10, (byte) 0xa5}));
    }

    @Test
    public void releaseNotesAreTrimmedAndShortened() {
        assertEquals("- one\n- two", UpdateRules.tidyNotes("- one\r\n- two\r\n", 100));
        assertEquals("", UpdateRules.tidyNotes(null, 100));
        assertEquals("abc…", UpdateRules.tidyNotes("abcdef", 3));
        assertEquals("ab", UpdateRules.tidyNotes("a\u0007b", 100));
    }
}
