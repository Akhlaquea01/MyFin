package io.github.akhlaquea01.myfin.biometric;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Holds one random secret, encrypted by an Android Keystore AES-GCM key that can only be used
 * after a fresh strong-biometric authentication (per use, bound to a BiometricPrompt
 * CryptoObject). The web layer wraps the PIN with that secret, so the PIN itself never reaches
 * native code. No Capacitor or UI types in here.
 */
final class BiometricVault {
    static final String KEY_ALIAS = "myfin_bio_v1";

    private static final String PROVIDER = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final String PREFS = "myfin_bio";
    private static final String P_IV = "iv";
    private static final String P_CT = "ct";
    private static final int GCM_TAG_BITS = 128;

    private final SharedPreferences prefs;

    BiometricVault(Context context) {
        this.prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    boolean hasEnrollment() {
        if (!prefs.contains(P_IV) || !prefs.contains(P_CT)) return false;
        try {
            KeyStore ks = loadKeyStore();
            return ks.containsAlias(KEY_ALIAS);
        } catch (GeneralSecurityException | IOException e) {
            return false;
        }
    }

    /** Creates a fresh biometric-bound key (replacing any old one) and an encrypt cipher on it. */
    Cipher newEncryptCipher() throws GeneralSecurityException, IOException {
        deleteKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, PROVIDER);
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // 0 = authentication is required for every use of the key; strong biometrics only.
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }
        generator.init(spec.build());
        SecretKey key = generator.generateKey();
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, key);
        return cipher;
    }

    /**
     * A decrypt cipher on the stored key. Throws KeyPermanentlyInvalidatedException (a
     * GeneralSecurityException) when the device's biometrics changed since enrollment.
     */
    Cipher newDecryptCipher() throws GeneralSecurityException, IOException {
        KeyStore ks = loadKeyStore();
        SecretKey key = (SecretKey) ks.getKey(KEY_ALIAS, null);
        if (key == null) throw new GeneralSecurityException("key missing");
        byte[] iv = Base64.decode(prefs.getString(P_IV, ""), Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
        return cipher;
    }

    void store(byte[] iv, byte[] ciphertext) {
        prefs.edit()
                .putString(P_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
                .putString(P_CT, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
                .commit();
    }

    byte[] storedCiphertext() {
        return Base64.decode(prefs.getString(P_CT, ""), Base64.NO_WRAP);
    }

    void clear() {
        prefs.edit().clear().commit();
        deleteKey();
    }

    private void deleteKey() {
        try {
            KeyStore ks = loadKeyStore();
            if (ks.containsAlias(KEY_ALIAS)) ks.deleteEntry(KEY_ALIAS);
        } catch (GeneralSecurityException | IOException ignored) {
            // Nothing more can be done; a stale key is replaced on the next enrollment.
        }
    }

    private static KeyStore loadKeyStore() throws GeneralSecurityException, IOException {
        KeyStore ks = KeyStore.getInstance(PROVIDER);
        ks.load(null);
        return ks;
    }
}
