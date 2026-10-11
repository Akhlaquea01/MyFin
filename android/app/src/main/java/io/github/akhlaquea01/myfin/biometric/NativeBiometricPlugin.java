package io.github.akhlaquea01.myfin.biometric;

import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.Lifecycle;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.SecureRandom;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.crypto.Cipher;

/**
 * Fingerprint unlock for the Android app. WebAuthn is not available inside Android WebView, so
 * the web layer uses this plugin instead. A random secret is generated on enroll and can only be
 * read back through a strong-biometric BiometricPrompt bound to a Keystore key. The web layer
 * wraps the PIN with that secret; the PIN itself is never sent to native code.
 *
 * Rejection codes (second argument of call.reject): cancelled, lockout, lockout-permanent,
 * timeout, none-enrolled, no-hardware, hw-unavailable, invalidated, not-enrolled, not-ready,
 * busy, error.
 */
@CapacitorPlugin(name = "NativeBiometric")
public class NativeBiometricPlugin extends Plugin {
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private BiometricVault vault;

    @Override
    public void load() {
        vault = new BiometricVault(getContext().getApplicationContext());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        int can = BiometricManager.from(getContext())
                .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG);
        boolean available = can == BiometricManager.BIOMETRIC_SUCCESS;
        result.put("available", available);
        if (!available) result.put("reason", availabilityReason(can));
        boolean enrolled = vault.hasEnrollment();
        result.put("enrolled", enrolled);
        result.put("invalidated", enrolled && isInvalidated());
        call.resolve(result);
    }

    @PluginMethod
    public void enroll(final PluginCall call) {
        if (!begin(call)) return;
        final AppCompatActivity activity = readyActivity(call);
        if (activity == null) return;

        final byte[] secret = new byte[32];
        new SecureRandom().nextBytes(secret);
        final Cipher cipher;
        try {
            cipher = vault.newEncryptCipher();
        } catch (Exception e) {
            Arrays.fill(secret, (byte) 0);
            fail(call, "error", "Could not create the biometric key.");
            return;
        }

        showPrompt(activity, call, cipher, new Outcome() {
            @Override
            public void onSuccess(Cipher authed) throws Exception {
                byte[] ciphertext = authed.doFinal(secret);
                vault.store(authed.getIV(), ciphertext);
                JSObject result = new JSObject();
                result.put("secret", Base64.encodeToString(secret, Base64.NO_WRAP));
                Arrays.fill(secret, (byte) 0);
                succeed(call, result);
            }

            @Override
            public void onFailure() {
                Arrays.fill(secret, (byte) 0);
                vault.clear();
            }
        });
    }

    @PluginMethod
    public void authenticate(final PluginCall call) {
        if (!begin(call)) return;
        final AppCompatActivity activity = readyActivity(call);
        if (activity == null) return;

        if (!vault.hasEnrollment()) {
            fail(call, "not-enrolled", "Fingerprint unlock is not set up.");
            return;
        }
        final Cipher cipher;
        try {
            cipher = vault.newDecryptCipher();
        } catch (KeyPermanentlyInvalidatedException e) {
            vault.clear();
            fail(call, "invalidated", "The fingerprints on this phone changed.");
            return;
        } catch (Exception e) {
            vault.clear();
            fail(call, "not-enrolled", "The saved fingerprint key is no longer available.");
            return;
        }

        showPrompt(activity, call, cipher, new Outcome() {
            @Override
            public void onSuccess(Cipher authed) throws Exception {
                byte[] secret = authed.doFinal(vault.storedCiphertext());
                JSObject result = new JSObject();
                result.put("secret", Base64.encodeToString(secret, Base64.NO_WRAP));
                Arrays.fill(secret, (byte) 0);
                succeed(call, result);
            }

            @Override
            public void onFailure() {
                // Nothing to clean up: a cancelled or failed read leaves the enrollment intact.
            }
        });
    }

    @PluginMethod
    public void clear(PluginCall call) {
        vault.clear();
        call.resolve();
    }

    private interface Outcome {
        void onSuccess(Cipher authed) throws Exception;

        void onFailure();
    }

    private void showPrompt(
            final AppCompatActivity activity,
            final PluginCall call,
            final Cipher cipher,
            final Outcome outcome) {
        final String title = call.getString("title", "Unlock MyFin");
        final String subtitle = call.getString("subtitle");
        final String cancelLabel = call.getString("cancelLabel", "Use PIN");

        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    BiometricPrompt prompt = new BiometricPrompt(
                            activity,
                            ContextCompat.getMainExecutor(activity),
                            new BiometricPrompt.AuthenticationCallback() {
                                @Override
                                public void onAuthenticationSucceeded(
                                        @NonNull BiometricPrompt.AuthenticationResult result) {
                                    try {
                                        BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                                        if (crypto == null || crypto.getCipher() == null) {
                                            outcome.onFailure();
                                            fail(call, "error", "Biometric check returned no key.");
                                            return;
                                        }
                                        outcome.onSuccess(crypto.getCipher());
                                    } catch (Exception e) {
                                        outcome.onFailure();
                                        fail(call, "error", "Could not read the saved key.");
                                    }
                                }

                                @Override
                                public void onAuthenticationError(
                                        int errorCode, @NonNull CharSequence errString) {
                                    outcome.onFailure();
                                    fail(call, errorReason(errorCode), errString.toString());
                                }
                            });

                    BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder()
                            .setTitle(title)
                            .setNegativeButtonText(cancelLabel)
                            .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                            .setConfirmationRequired(false);
                    if (subtitle != null) info.setSubtitle(subtitle);

                    prompt.authenticate(info.build(), new BiometricPrompt.CryptoObject(cipher));
                } catch (Exception e) {
                    outcome.onFailure();
                    fail(call, "error", "Could not show the fingerprint prompt.");
                }
            }
        });
    }

    /** Rejects with `busy` unless this call may take the single in-flight slot. */
    private boolean begin(PluginCall call) {
        if (busy.compareAndSet(false, true)) return true;
        call.reject("Another fingerprint request is already in progress.", "busy");
        return false;
    }

    /** The visible activity, or null after rejecting with `not-ready` (and releasing the slot). */
    private AppCompatActivity readyActivity(PluginCall call) {
        AppCompatActivity activity = getActivity();
        if (activity == null
                || !activity.getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED)) {
            fail(call, "not-ready", "The app is not in the foreground.");
            return null;
        }
        return activity;
    }

    private void succeed(PluginCall call, JSObject result) {
        busy.set(false);
        call.resolve(result);
    }

    private void fail(PluginCall call, String code, String message) {
        busy.set(false);
        call.reject(message, code);
    }

    private boolean isInvalidated() {
        try {
            vault.newDecryptCipher();
            return false;
        } catch (KeyPermanentlyInvalidatedException e) {
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String availabilityReason(int canAuthenticate) {
        switch (canAuthenticate) {
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                return "no-hardware";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                return "hw-unavailable";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                return "none-enrolled";
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED:
                return "security-update-required";
            default:
                return "unsupported";
        }
    }

    private static String errorReason(int errorCode) {
        switch (errorCode) {
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_CANCELED:
                return "cancelled";
            case BiometricPrompt.ERROR_LOCKOUT:
                return "lockout";
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "lockout-permanent";
            case BiometricPrompt.ERROR_TIMEOUT:
                return "timeout";
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
                return "none-enrolled";
            case BiometricPrompt.ERROR_HW_NOT_PRESENT:
                return "no-hardware";
            case BiometricPrompt.ERROR_HW_UNAVAILABLE:
                return "hw-unavailable";
            default:
                return "error";
        }
    }
}
