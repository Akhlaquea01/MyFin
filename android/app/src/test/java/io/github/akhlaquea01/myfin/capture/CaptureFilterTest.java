package io.github.akhlaquea01.myfin.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

/**
 * The native filter only has to be generous enough that nothing real is lost before it is sealed;
 * the web layer makes the real decision after unlock. These tests pin what must get through and
 * what must never be stored at all.
 */
public class CaptureFilterTest {
    private static final String AXIS_UPI_DEBIT = "INR 97.00 debited\nA/c no. XX0146\n12-10-26, 19:29:33\n"
            + "UPI/P2M/548275113159/MDMAHFOOZ\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank";

    @Test
    public void bankMessagesAboutMoneyMovingGetThrough() {
        assertTrue(CaptureFilter.isCandidateSms("AX-AXISBK-S", AXIS_UPI_DEBIT));
        assertTrue(CaptureFilter.isCandidateSms("VM-HDFCBK", "Rs.500 debited from A/c XX1234 to AMAZON"));
        assertTrue(CaptureFilter.isCandidateSms(
                "VM-HDFCBK", "Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 05/10/26"));
        assertTrue(CaptureFilter.isCandidateSms("AD-SBIINB", "Acct XX987 is credited with Rs 5,000.00"));
        assertTrue(CaptureFilter.isCandidateSms("VM-HDFCBK", "Spent Card XX5678 INR 1,299.00 AMAZON PAY"));
    }

    @Test
    public void aMessageWithNoCurrencySymbolStillGetsThrough() {
        assertTrue(CaptureFilter.isCandidateSms("AD-SBIINB", "A/c X1234 debited by 250.0 on 05Oct26"));
    }

    @Test
    public void oneTimeCodesAreNeverStored() {
        assertFalse(CaptureFilter.isCandidateSms("VM-HDFCBK", "123456 is your OTP for txn of Rs.500 at AMAZON"));
        assertFalse(CaptureFilter.isCandidateSms("VM-HDFCBK", "Your one time password for Rs.500 payment is 4321"));
        assertFalse(CaptureFilter.isCandidateSms("VM-HDFCBK", "Verification code 998877 for debit of Rs.100"));
    }

    @Test
    public void personalTextsAreNeverStored() {
        assertFalse(CaptureFilter.isCandidateSms("+919876543210", "I paid Rs 500 to you yesterday"));
        assertFalse(CaptureFilter.isCandidateSms("09876543210", "Sent you 500"));
        assertTrue(CaptureFilter.isPersonalSender("+91 98765-43210"));
        assertFalse(CaptureFilter.isPersonalSender("VM-HDFCBK"));
    }

    @Test
    public void personalTextsAboutPaymentsWithoutAccountDigitsAreNeverStored() {
        assertFalse(CaptureFilter.isCandidateSms("+919876543210", "I paid Rs 500 on my card yesterday"));
        assertFalse(CaptureFilter.isCandidateSms("+919876543210", "Sent 500 rupees via UPI, ref 548275113159"));
    }

    @Test
    public void aBankAlertFromAPhoneNumberStillGetsThrough() {
        // Forwarded from a contact, or sent from a number the bank uses: still a bank alert.
        assertTrue(CaptureFilter.isCandidateSms("+919876543210", AXIS_UPI_DEBIT));
        assertTrue(CaptureFilter.isCandidateSms(
                "09876543210", "Spent Card XX5678 INR 1,299.00 AMAZON PAY"));
    }

    @Test
    public void bankAlertsNeedACurrencyAmountAndAccountDigits() {
        assertTrue(CaptureFilter.looksLikeBankAlert(AXIS_UPI_DEBIT));
        assertTrue(CaptureFilter.looksLikeBankAlert("Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY"));
        assertTrue(CaptureFilter.looksLikeBankAlert("Acct XX987 is credited with ₹5,000.00"));
        assertFalse(CaptureFilter.looksLikeBankAlert("A/c XX0146 debited by 250.0")); // no currency
        assertFalse(CaptureFilter.looksLikeBankAlert("INR 97.00 debited")); // no account digits
        assertFalse(CaptureFilter.looksLikeBankAlert("123456 is your OTP: INR 97.00 debited from A/c XX0146"));
        assertFalse(CaptureFilter.looksLikeBankAlert(null));
    }

    @Test
    public void onlyNamedMessagingAppsAreRead() {
        assertEquals("Google Messages", CaptureFilter.messagingAppName("com.google.android.apps.messaging"));
        assertEquals("Samsung Messages", CaptureFilter.messagingAppName("com.samsung.android.messaging"));
        assertNull(CaptureFilter.messagingAppName("com.whatsapp"));
        assertNull(CaptureFilter.messagingAppName(null));
        assertNull(CaptureFilter.paymentAppName("com.google.android.apps.messaging"));
    }

    @Test
    public void messagesThatCannotBeAboutMoneyAreNeverStored() {
        assertFalse(CaptureFilter.looksLikeTransaction("Your account was debited")); // no amount
        assertFalse(CaptureFilter.looksLikeTransaction("Avl Bal in A/c XX1234 is Rs.9,000.00")); // no verb
        assertFalse(CaptureFilter.looksLikeTransaction("Please present your ID 12345")); // 'present' is not 'sent'
        assertFalse(CaptureFilter.looksLikeTransaction("Lunch at 1pm?"));
        assertFalse(CaptureFilter.looksLikeTransaction(null));
        assertFalse(CaptureFilter.looksLikeTransaction("   "));
    }

    @Test
    public void overlongMessagesAreNeverStored() {
        StringBuilder text = new StringBuilder("Rs.500 debited ");
        while (text.length() <= CaptureFilter.MAX_LENGTH) text.append("x");
        assertFalse(CaptureFilter.looksLikeTransaction(text.toString()));
    }

    @Test
    public void onlyNamedPaymentAppsAreRead() {
        assertEquals("Google Pay", CaptureFilter.paymentAppName("com.google.android.apps.nbu.paisa.user"));
        assertEquals("PhonePe", CaptureFilter.paymentAppName("com.phonepe.app"));
        assertNull(CaptureFilter.paymentAppName("com.whatsapp"));
        assertNull(CaptureFilter.paymentAppName(null));
    }

    @Test
    public void creditCardWordingTheWebFilterAcceptsGetsThroughHere() {
        assertTrue(CaptureFilter.isCandidateSms("VM-ICICIB",
                "Txn of INR 1,234.00 done on ICICI Bank Credit Card XX1234 at NETFLIX.COM"));
        assertTrue(CaptureFilter.isCandidateSms("VM-SBICRD",
                "Payment of Rs 649.00 on card XX1234 to NETFLIX was successful"));
        assertTrue(CaptureFilter.isCandidateSms("AX-AMEXIN",
                "You have swiped your Amex Card XX1001 for INR 2,499.00 at ZOMATO"));
    }

    @Test
    public void aDebitAlertWithAFraudWarningFooterIsNotMistakenForACode() {
        assertTrue(CaptureFilter.isCandidateSms("VM-HDFCBK",
                "Rs.500.00 debited from A/c XX1234 on 05-Oct-26 to AMAZON. Never share OTP, CVV or PIN."));
        // A code message still never reaches disk.
        assertFalse(CaptureFilter.isCandidateSms("VM-HDFCBK",
                "123456 is your OTP for txn of Rs.500 at AMAZON. Do not share."));
    }

    /**
     * Every message in tests/fixtures/captureAcceptCases.txt is one the web layer's filter accepts
     * (captureFilter.test.ts checks that side), so this filter, which only has to be more
     * generous, must let all of them through. A real transaction dropped here is lost for good.
     */
    @Test
    public void everySharedAcceptCaseGetsThrough() throws IOException {
        List<String[]> cases = sharedAcceptCases();
        assertTrue("the shared fixture should not be empty", cases.size() >= 10);
        for (String[] c : cases) {
            assertTrue("dropped by the native filter: " + c[1], CaptureFilter.isCandidateSms(c[0], c[1]));
        }
    }

    private static List<String[]> sharedAcceptCases() throws IOException {
        // Gradle runs unit tests from the module directory (android/app); an IDE may run from the root.
        String[] candidates = {
            "../../tests/fixtures/captureAcceptCases.txt",
            "tests/fixtures/captureAcceptCases.txt"
        };
        File file = null;
        for (String candidate : candidates) {
            File f = new File(candidate);
            if (f.isFile()) {
                file = f;
                break;
            }
        }
        if (file == null) {
            throw new IOException("captureAcceptCases.txt not found from " + new File(".").getAbsolutePath());
        }
        String raw = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)
                .replace("\r\n", "\n");
        List<String[]> out = new ArrayList<>();
        // Sections are separated by a line of four dashes; the first one is the file's header.
        String[] sections = raw.split("(?m)^----$");
        for (int i = 1; i < sections.length; i++) {
            String section = sections[i].trim();
            if (section.isEmpty()) continue;
            int newline = section.indexOf('\n');
            String sender = section.substring(0, newline).replaceFirst("^sender:\\s*", "").trim();
            out.add(new String[] {sender, section.substring(newline + 1)});
        }
        return out;
    }
}
