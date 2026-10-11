package io.github.akhlaquea01.myfin.capture;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONException;

import java.security.GeneralSecurityException;
import java.util.ArrayList;
import java.util.List;

/**
 * Bridge between the web app and the native message capture (SMS receiver and notification
 * listener). The receivers keep working with the app closed: they seal each message with the
 * public key the web layer provides and queue it; this plugin lets the app read and acknowledge
 * that queue after unlock. The permission methods checkPermissions and requestPermissions are
 * inherited from Plugin and take the aliases "sms" and "postNotifications".
 */
@CapacitorPlugin(
        name = "TransactionCapture",
        permissions = {
            @Permission(alias = "sms", strings = {Manifest.permission.RECEIVE_SMS}),
            @Permission(alias = "postNotifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
        })
public class TransactionCapturePlugin extends Plugin {
    private static final int DEFAULT_DRAIN_LIMIT = 200;
    /** What a self test seals; the web layer checks it comes back exactly like this. */
    private static final String SELF_TEST_JSON = "{\"selfTest\":\"myfin-capture-self-test\"}";

    @Override
    public void load() {
        CaptureIntake.setListener(new CaptureIntake.Listener() {
            @Override
            public void onCaptured(int pending) {
                JSObject data = new JSObject();
                data.put("pending", pending);
                notifyListeners("captured", data);
            }
        });
    }

    @Override
    protected void handleOnResume() {
        CaptureNotifier.setAppInForeground(true);
    }

    @Override
    protected void handleOnPause() {
        CaptureNotifier.setAppInForeground(false);
    }

    @Override
    protected void handleOnDestroy() {
        CaptureIntake.setListener(null);
        CaptureNotifier.setAppInForeground(false);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        openSettings(call, new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName()));
        openSettings(call, intent);
    }

    @PluginMethod
    public void setSealingKey(PluginCall call) {
        String publicKey = call.getString("publicKey");
        String keyId = call.getString("keyId");
        if (publicKey == null || keyId == null || keyId.isEmpty()) {
            call.reject("publicKey and keyId are required.", "invalid");
            return;
        }
        try {
            SealedBox.parsePublicKey(Base64.decode(publicKey, Base64.NO_WRAP));
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            call.reject("The sealing key is not a valid RSA public key.", "invalid-key");
            return;
        }
        CaptureQueue.get(getContext()).setSealingKey(publicKey, keyId);
        call.resolve(status());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        CaptureQueue.get(getContext()).setEnabled(call.getBoolean("sms"), call.getBoolean("notifications"));
        call.resolve(status());
    }

    /**
     * Seals a known string with the stored key (without queueing it), so the web layer can open
     * it and prove both sides agree on the format before capture is switched on.
     */
    @PluginMethod
    public void selfTest(PluginCall call) {
        CaptureQueue queue = CaptureQueue.get(getContext());
        if (!queue.hasKey()) {
            call.reject("No sealing key has been set.", "no-key");
            return;
        }
        try {
            JSObject result = new JSObject();
            result.put("item", new JSObject(CaptureIntake.seal(queue, SELF_TEST_JSON, "self-test").toString()));
            call.resolve(result);
        } catch (JSONException | GeneralSecurityException e) {
            call.reject("Could not seal the test message.", "seal-failed");
        }
    }

    @PluginMethod
    public void drainQueue(PluginCall call) {
        CaptureQueue queue = CaptureQueue.get(getContext());
        int limit = Math.max(1, Math.min(call.getInt("limit", DEFAULT_DRAIN_LIMIT), CaptureQueue.MAX_ITEMS));
        try {
            JSArray items = new JSArray();
            List<String> json = queue.list(limit);
            for (String item : json) items.put(new JSObject(item));

            JSObject result = new JSObject();
            result.put("items", items);
            result.put("remaining", Math.max(0, queue.count() - json.size()));
            result.put("dropped", queue.dropped());
            queue.resetDropped();
            call.resolve(result);
        } catch (JSONException e) {
            call.reject("Could not read the queue.", "queue-failed");
        }
    }

    @PluginMethod
    public void ack(PluginCall call) {
        JSArray ids = call.getArray("ids");
        if (ids == null) {
            call.reject("ids is required.", "invalid");
            return;
        }
        try {
            List<String> wanted = new ArrayList<>();
            for (int i = 0; i < ids.length(); i++) wanted.add(ids.getString(i));
            CaptureQueue queue = CaptureQueue.get(getContext());
            JSObject result = new JSObject();
            result.put("removed", queue.remove(wanted));
            result.put("remaining", queue.count());
            call.resolve(result);
        } catch (JSONException e) {
            call.reject("ids must be strings.", "invalid");
        }
    }

    @PluginMethod
    public void cancelAlert(PluginCall call) {
        CaptureNotifier.cancel(getContext());
        call.resolve();
    }

    /** Forgets everything: used when all app data is cleared, so old queued messages cannot flow
     *  into a new ledger. */
    @PluginMethod
    public void clear(PluginCall call) {
        CaptureQueue.get(getContext()).clearAll();
        CaptureNotifier.cancel(getContext());
        call.resolve();
    }

    private JSObject status() {
        Context context = getContext();
        CaptureQueue queue = CaptureQueue.get(context);
        JSObject status = new JSObject();
        status.put("sdkInt", Build.VERSION.SDK_INT);
        status.put("sms", getPermissionState("sms").toString());
        status.put("postNotifications", getPermissionState("postNotifications").toString());
        status.put(
                "notificationListenerEnabled",
                NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.getPackageName()));
        status.put("alertsEnabled", NotificationManagerCompat.from(context).areNotificationsEnabled());
        status.put("sealingKeyPresent", queue.hasKey());
        status.put("smsEnabled", queue.smsEnabled());
        status.put("notificationsEnabled", queue.notificationsEnabled());
        status.put("pending", queue.count());
        status.put("dropped", queue.dropped());
        return status;
    }

    private void openSettings(PluginCall call, Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("This phone has no screen for that setting.", "unavailable");
        }
    }
}
