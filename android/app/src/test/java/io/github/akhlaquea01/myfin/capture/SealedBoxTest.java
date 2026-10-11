package io.github.akhlaquea01.myfin.capture;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

public class SealedBoxTest {
    private static final byte[] MESSAGE =
            "Rs.250.00 debited from A/c XX1234 to SWIGGY".getBytes(StandardCharsets.UTF_8);

    private static KeyPair newPair() throws Exception {
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        return generator.generateKeyPair();
    }

    /** The web layer's job, done here with the same algorithms so the two ends are checked together. */
    private static byte[] open(KeyPair pair, SealedBox.Sealed sealed) throws Exception {
        Cipher rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-1AndMGF1Padding");
        rsa.init(Cipher.DECRYPT_MODE, pair.getPrivate());
        byte[] aesKey = rsa.doFinal(sealed.wrappedKey);
        Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
        gcm.init(Cipher.DECRYPT_MODE, new SecretKeySpec(aesKey, "AES"), new GCMParameterSpec(128, sealed.iv));
        return gcm.doFinal(sealed.ciphertext);
    }

    @Test
    public void sealedMessageOpensWithThePrivateKey() throws Exception {
        KeyPair pair = newPair();
        SealedBox.Sealed sealed = SealedBox.seal(SealedBox.parsePublicKey(pair.getPublic().getEncoded()), MESSAGE);
        assertArrayEquals(MESSAGE, open(pair, sealed));
    }

    @Test
    public void theMessageIsNotVisibleInTheSealedParts() throws Exception {
        KeyPair pair = newPair();
        SealedBox.Sealed sealed = SealedBox.seal(pair.getPublic(), MESSAGE);
        String all = new String(sealed.ciphertext, StandardCharsets.ISO_8859_1)
                + new String(sealed.wrappedKey, StandardCharsets.ISO_8859_1);
        assertFalse(all.contains("SWIGGY"));
        assertFalse(all.contains("1234"));
    }

    @Test
    public void everyMessageGetsAFreshKeyAndIv() throws Exception {
        KeyPair pair = newPair();
        SealedBox.Sealed a = SealedBox.seal(pair.getPublic(), MESSAGE);
        SealedBox.Sealed b = SealedBox.seal(pair.getPublic(), MESSAGE);
        assertFalse(Arrays.equals(a.iv, b.iv));
        assertFalse(Arrays.equals(a.wrappedKey, b.wrappedKey));
        assertFalse(Arrays.equals(a.ciphertext, b.ciphertext));
        assertEquals(12, a.iv.length);
        // Ciphertext is the message plus the 16-byte GCM tag, the layout the web layer expects.
        assertEquals(MESSAGE.length + 16, a.ciphertext.length);
    }

    @Test
    public void aTamperedMessageIsRejected() throws Exception {
        KeyPair pair = newPair();
        SealedBox.Sealed sealed = SealedBox.seal(pair.getPublic(), MESSAGE);
        sealed.ciphertext[0] ^= 0x01;
        try {
            open(pair, sealed);
            fail("a tampered message must not open");
        } catch (GeneralSecurityException expected) {
            assertNotNull(expected);
        }
    }

    @Test
    public void aMessageSealedToAnotherKeyDoesNotOpen() throws Exception {
        KeyPair mine = newPair();
        KeyPair theirs = newPair();
        SealedBox.Sealed sealed = SealedBox.seal(theirs.getPublic(), MESSAGE);
        try {
            open(mine, sealed);
            fail("a message sealed to another key must not open");
        } catch (GeneralSecurityException expected) {
            assertNotNull(expected);
        }
    }

    @Test
    public void garbageIsNotAPublicKey() {
        try {
            SealedBox.parsePublicKey(new byte[] {1, 2, 3});
            fail("garbage must not parse as a public key");
        } catch (GeneralSecurityException expected) {
            assertNotNull(expected);
        }
    }
}
