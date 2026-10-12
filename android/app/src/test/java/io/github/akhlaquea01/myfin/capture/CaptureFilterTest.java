package io.github.akhlaquea01.myfin.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

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
}
