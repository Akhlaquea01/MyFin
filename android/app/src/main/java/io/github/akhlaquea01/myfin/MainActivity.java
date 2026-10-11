package io.github.akhlaquea01.myfin;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import io.github.akhlaquea01.myfin.biometric.NativeBiometricPlugin;
import io.github.akhlaquea01.myfin.capture.TransactionCapturePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before super.onCreate builds the bridge.
        registerPlugin(NativeBiometricPlugin.class);
        registerPlugin(TransactionCapturePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
