package io.github.akhlaquea01.myfin.capture;

import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * A coarse first pass over incoming messages, done before anything is stored: it exists so that
 * an unrelated personal SMS or notification is never written to disk at all, not to decide what
 * is a transaction. It is deliberately more generous than the web layer's filter (which is the
 * authority and runs after unlock): anything this rejects is gone for good, anything it lets
 * through is sealed and judged properly later.
 *
 * Pure Java with no android.* types, so it runs in plain JUnit.
 */
public final class CaptureFilter {
    /** Longer than any real bank alert. */
    static final int MAX_LENGTH = 1000;

    private static final Pattern PHONE_NUMBER = Pattern.compile("^\\+?\\d{8,}$");

    private static final Pattern OTP = Pattern.compile(
            "\\botp\\b|one[- ]?time|verification code|\\bcvv\\b|\\bpasscode\\b",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern TRANSACTION_VERB = Pattern.compile(
            "\\b(?:debited|credited|spent|paid|received|withdrawn|deposited|sent|purchase[d]?"
                    + "|transferred|refund(?:ed)?|reversed|reversal|deducted|charged|debit|credit)\\b",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern DIGIT = Pattern.compile("\\d");

    /**
     * Payment and banking apps whose notifications are read. Everything else is ignored without
     * even looking at its text. The values are the names shown to the user. Package names change
     * between app versions and regions; an app missing here simply is not captured from (the
     * bank's SMS still is), so verify against a phone with {@code adb shell pm list packages}.
     */
    private static final Map<String, String> PAYMENT_APPS;

    static {
        Map<String, String> apps = new HashMap<>();
        apps.put("com.google.android.apps.nbu.paisa.user", "Google Pay");
        apps.put("com.phonepe.app", "PhonePe");
        apps.put("net.one97.paytm", "Paytm");
        apps.put("in.org.npci.upiapp", "BHIM");
        apps.put("com.dreamplug.androidapp", "CRED");
        apps.put("com.freecharge.android", "Freecharge");
        apps.put("com.snapwork.hdfc", "HDFC Bank");
        apps.put("com.csam.icici.bank.imobile", "ICICI iMobile");
        apps.put("com.sbi.lotusintouch", "YONO SBI");
        apps.put("com.axis.mobile", "Axis Mobile");
        apps.put("com.msf.kbank.mobile", "Kotak");
        PAYMENT_APPS = Collections.unmodifiableMap(apps);
    }

    private CaptureFilter() {}

    /** The user-facing name of an app whose notifications are read, or null for any other app. */
    public static String paymentAppName(String packageName) {
        return packageName == null ? null : PAYMENT_APPS.get(packageName);
    }

    /** A sender that is only a phone number is a person, not a bank. */
    public static boolean isPersonalSender(String sender) {
        if (sender == null) return false;
        return PHONE_NUMBER.matcher(sender.replaceAll("[\\s-]", "")).matches();
    }

    /** Whether the text could be about money moving, so that it is worth sealing and queueing. */
    public static boolean looksLikeTransaction(String text) {
        if (text == null) return false;
        String trimmed = text.trim();
        if (trimmed.isEmpty() || trimmed.length() > MAX_LENGTH) return false;
        String lower = trimmed.toLowerCase(Locale.ROOT);
        if (OTP.matcher(lower).find()) return false;
        return TRANSACTION_VERB.matcher(lower).find() && DIGIT.matcher(lower).find();
    }

    public static boolean isCandidateSms(String sender, String body) {
        return !isPersonalSender(sender) && looksLikeTransaction(body);
    }
}
