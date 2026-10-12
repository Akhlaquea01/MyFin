package io.github.akhlaquea01.myfin;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import io.github.akhlaquea01.myfin.backup.NativeBackupFolderPlugin;
import io.github.akhlaquea01.myfin.biometric.NativeBiometricPlugin;
import io.github.akhlaquea01.myfin.capture.TransactionCapturePlugin;
import io.github.akhlaquea01.myfin.share.NativeSharePlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before super.onCreate builds the bridge.
        registerPlugin(NativeBiometricPlugin.class);
        registerPlugin(TransactionCapturePlugin.class);
        registerPlugin(NativeSharePlugin.class);
        registerPlugin(NativeBackupFolderPlugin.class);
        // After the system killed and restored the app, the activity reports its ORIGINAL launch
        // intent again; a share in it was already handled and must not be replayed.
        NativeSharePlugin.setRestoredFromSavedState(savedInstanceState != null);
        super.onCreate(savedInstanceState);
    }
}
