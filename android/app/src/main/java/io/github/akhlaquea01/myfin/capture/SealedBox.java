package io.github.akhlaquea01.myfin.capture;

import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.X509EncodedKeySpec;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Locks a message away so that only the web layer, after the user unlocks the app, can read it.
 *
 * Receivers run with no PIN and no encryption key, and must not leave the message readable on
 * disk. So the web layer generates an RSA key pair, keeps the private half encrypted under the
 * PIN-derived key, and hands only the PUBLIC half to native code. This class can therefore only
 * ever seal. Each message gets a fresh AES-256-GCM key (the message is encrypted with it), and
 * that AES key is wrapped with the RSA public key using OAEP with SHA-1 and MGF1-SHA-1 — the one
 * combination Java, Android and WebCrypto all agree on (SHA-256 differs in the MGF1 hash).
 *
 * Pure Java with no android.* types, so it runs in plain JUnit. Bytes in, bytes out: callers
 * encode base64, because android.util.Base64 is not available off-device and java.util.Base64
 * needs API 26 (the app supports 24).
 */
public final class SealedBox {
    private static final String AES_GCM = "AES/GCM/NoPadding";
    private static final String RSA_OAEP = "RSA/ECB/OAEPWithSHA-1AndMGF1Padding";
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_BYTES = 12;

    private static final SecureRandom RANDOM = new SecureRandom();

    /** The three parts of a sealed message. {@code ciphertext} has the GCM tag appended. */
    public static final class Sealed {
        public final byte[] wrappedKey;
        public final byte[] iv;
        public final byte[] ciphertext;

        Sealed(byte[] wrappedKey, byte[] iv, byte[] ciphertext) {
            this.wrappedKey = wrappedKey;
            this.iv = iv;
            this.ciphertext = ciphertext;
        }
    }

    private SealedBox() {}

    /** Parses an X.509 SubjectPublicKeyInfo RSA public key, as WebCrypto exports it. */
    public static PublicKey parsePublicKey(byte[] spki) throws GeneralSecurityException {
        return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(spki));
    }

    public static Sealed seal(PublicKey publicKey, byte[] plaintext) throws GeneralSecurityException {
        KeyGenerator generator = KeyGenerator.getInstance("AES");
        generator.init(256, RANDOM);
        SecretKey aesKey = generator.generateKey();

        byte[] iv = new byte[GCM_IV_BYTES];
        RANDOM.nextBytes(iv);
        Cipher gcm = Cipher.getInstance(AES_GCM);
        gcm.init(Cipher.ENCRYPT_MODE, aesKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] ciphertext = gcm.doFinal(plaintext);

        Cipher rsa = Cipher.getInstance(RSA_OAEP);
        rsa.init(Cipher.ENCRYPT_MODE, publicKey);
        byte[] wrappedKey = rsa.doFinal(aesKey.getEncoded());

        return new Sealed(wrappedKey, iv, ciphertext);
    }
}
