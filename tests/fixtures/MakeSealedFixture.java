// Regenerates tests/fixtures/javaSealedItem.json from the real Android SealedBox.java, so the web
// side's tests open an item the Java code actually produced (not a re-creation of its recipe).
// Needs only a JDK; run from the repository root:
//
//   javac -d /tmp/sealed-fixture
//     android/app/src/main/java/io/github/akhlaquea01/myfin/capture/SealedBox.java
//     android/app/src/main/java/io/github/akhlaquea01/myfin/capture/CaptureFilter.java
//     tests/fixtures/MakeSealedFixture.java
//   (all on one line; the files are listed one per line here for readability)
//   java -cp /tmp/sealed-fixture MakeSealedFixture > /tmp/fixture.json
//
// Then put the JSON into tests/fixtures/javaSealedItem.json (keeping its "_comment"). The
// checks printed to stderr are a quick sanity pass over CaptureFilter, which runs here because
// it is pure Java too.
import io.github.akhlaquea01.myfin.capture.CaptureFilter;
import io.github.akhlaquea01.myfin.capture.SealedBox;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Base64;

public class MakeSealedFixture {
    public static void main(String[] args) throws Exception {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048);
        KeyPair pair = kpg.generateKeyPair();

        String payload = "{\"channel\":\"sms\",\"sender\":\"VM-HDFCBK\",\"body\":\"Rs.250.00 debited from A/c XX1234 to SWIGGY on 05-10-26 Ref 628123456789\",\"receivedAt\":1791181800000}";
        byte[] spki = pair.getPublic().getEncoded();
        SealedBox.Sealed sealed = SealedBox.seal(SealedBox.parsePublicKey(spki), payload.getBytes(StandardCharsets.UTF_8));

        Base64.Encoder b64 = Base64.getEncoder();
        StringBuilder json = new StringBuilder();
        json.append("{\n");
        json.append("  \"generatedBy\": \"android SealedBox.java on a desktop JVM (see scripts/ note in the test)\",\n");
        json.append("  \"keyId\": \"java-fixture\",\n");
        json.append("  \"publicKey\": \"").append(b64.encodeToString(spki)).append("\",\n");
        json.append("  \"privateKeyPkcs8\": \"").append(b64.encodeToString(pair.getPrivate().getEncoded())).append("\",\n");
        json.append("  \"payload\": ").append(payload).append(",\n");
        json.append("  \"item\": {\n");
        json.append("    \"v\": 1,\n");
        json.append("    \"id\": \"java-made\",\n");
        json.append("    \"kid\": \"java-fixture\",\n");
        json.append("    \"wk\": \"").append(b64.encodeToString(sealed.wrappedKey)).append("\",\n");
        json.append("    \"iv\": \"").append(b64.encodeToString(sealed.iv)).append("\",\n");
        json.append("    \"ct\": \"").append(b64.encodeToString(sealed.ciphertext)).append("\"\n");
        json.append("  }\n");
        json.append("}\n");
        System.out.print(json);

        // Filter spot checks, to stderr so they do not pollute the fixture.
        check("candidate bank sms", CaptureFilter.isCandidateSms("VM-HDFCBK", "Rs.500 debited from A/c XX1234 to AMAZON"), true);
        check("keyword amount without currency", CaptureFilter.isCandidateSms("AD-SBIINB", "A/c X1234 debited by 250.0 on 05Oct26"), true);
        check("otp", CaptureFilter.isCandidateSms("VM-HDFCBK", "123456 is your OTP for txn of Rs.500"), false);
        check("personal sender", CaptureFilter.isCandidateSms("+919876543210", "I paid Rs 500 to you"), false);
        check("no digit", CaptureFilter.isCandidateSms("VM-HDFCBK", "Your account was debited"), false);
        check("no verb", CaptureFilter.isCandidateSms("VM-HDFCBK", "Avl Bal in A/c XX1234 is Rs.9,000.00"), false);
        check("present is not sent", CaptureFilter.isCandidateSms("VM-X", "Please present your ID 12345"), false);
        check("too long", CaptureFilter.isCandidateSms("VM-HDFCBK", "Rs.500 debited " + "x".repeat(1100)), false);
        check("gpay name", "Google Pay".equals(CaptureFilter.paymentAppName("com.google.android.apps.nbu.paisa.user")), true);
        check("unknown app", CaptureFilter.paymentAppName("com.whatsapp") == null, true);
    }

    private static void check(String name, boolean actual, boolean expected) {
        System.err.println((actual == expected ? "ok   " : "FAIL ") + name);
        if (actual != expected) System.exit(1);
    }
}
