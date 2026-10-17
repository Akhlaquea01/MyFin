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

    // Real debit and card alerts end with a fraud warning ("Never share OTP/CVV/PIN with anyone.").
    // That sentence is cut out before the OTP test so the alert is not mistaken for a code message.
    // Mirrors withoutWarnings in captureFilter.ts.
    private static final Pattern WARNING_SENTENCE = Pattern.compile(
            "[^.!?\\n]*\\b(?:do not|don'?t|never|please do not|kindly do not)\\s+(?:to\\s+)?"
                    + "(?:share|disclose|reveal|give)\\b[^.!?\\n]*[.!?]?",
            Pattern.CASE_INSENSITIVE);

    // Keep in step with TRANSACTION_VERB in captureFilter.ts: anything the web filter accepts must
    // get past this one, which is only ever allowed to be more generous. The shared cases in
    // tests/fixtures/captureAcceptCases.txt are checked on both sides.
    private static final Pattern TRANSACTION_VERB = Pattern.compile(
            "\\b(?:debited|credited|spent|paid|received|withdrawn|deposited|sent|purchase[d]?"
                    + "|transferred|refund(?:ed)?|reversed|reversal|deducted|charged|payment of"
                    + "|txn of|transaction of|swiped|used (?:for|at)|debit|credit)\\b",
            Pattern.CASE_INSENSITIVE);

    private static final Pattern DIGIT = Pattern.compile("\\d");

    // A currency-marked amount ("INR 97.00", "Rs.500", "₹97").
    private static final Pattern CURRENCY_AMOUNT = Pattern.compile(
            "(?:\\b(?:rs\\.?|inr)|\u20B9)\\s*\\d", Pattern.CASE_INSENSITIVE);

    // "A/c no. XX0146", "Acct XX987", "Card ending 5678": the account digits a bank alert names.
    private static final Pattern ACCOUNT_OR_CARD = Pattern.compile(
            "\\b(?:a/?c|acct?|account|card)\\b[^0-9]{0,15}\\d{3,}", Pattern.CASE_INSENSITIVE);

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

    /**
     * Messaging apps whose notifications are read as a second way to see a bank message: a bank
     * alert that reaches the phone over RCS (or from a number the SMS receiver skips) never fires
     * the SMS broadcast, but the app still posts a notification. Their notifications also carry
     * personal chats, so unlike {@link #PAYMENT_APPS} they are held to {@link #looksLikeBankAlert}.
     */
    private static final Map<String, String> MESSAGING_APPS;

    static {
        Map<String, String> apps = new HashMap<>();
        apps.put("com.google.android.apps.messaging", "Google Messages");
        apps.put("com.samsung.android.messaging", "Samsung Messages");
        apps.put("com.android.mms", "Messages");
        apps.put("com.android.messaging", "Messages");
        MESSAGING_APPS = Collections.unmodifiableMap(apps);
    }

    private CaptureFilter() {}

    /** The user-facing name of an app whose notifications are read, or null for any other app. */
    public static String paymentAppName(String packageName) {
        return packageName == null ? null : PAYMENT_APPS.get(packageName);
    }

    /** The user-facing name of a messaging app whose notifications are read, or null. */
    public static String messagingAppName(String packageName) {
        return packageName == null ? null : MESSAGING_APPS.get(packageName);
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
        if (OTP.matcher(WARNING_SENTENCE.matcher(lower).replaceAll(" ")).find()) return false;
        return TRANSACTION_VERB.matcher(lower).find() && DIGIT.matcher(lower).find();
    }

    /**
     * Stricter than {@link #looksLikeTransaction}, for sources that also carry personal chat (a
     * number-sender SMS, a messaging app's notification): the text must read like a bank alert,
     * with a currency amount and the account or card digits it is about.
     */
    public static boolean looksLikeBankAlert(String text) {
        return looksLikeTransaction(text)
                && CURRENCY_AMOUNT.matcher(text).find()
                && ACCOUNT_OR_CARD.matcher(text).find();
    }

    public static boolean isCandidateSms(String sender, String body) {
        // A bank alert forwarded from, or sent by, a phone number is still a bank alert.
        return isPersonalSender(sender) ? looksLikeBankAlert(body) : looksLikeTransaction(body);
    }
}
