package io.github.akhlaquea01.myfin.capture;

import android.content.Context;
import android.util.Base64;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.PublicKey;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * The single path a captured message takes on the native side: debounce, seal, queue, tell the
 * user. Shared by the SMS receiver and the notification listener. It never logs, because a log
 * line could carry the message.
 */
final class CaptureIntake {
    /** Called (on whatever thread captured the message) while a web view is alive to hear it. */
    interface Listener {
        void onCaptured(int pending);
    }

    /** The same text from the same place inside this window is one message, not two. */
    private static final long DEBOUNCE_MS = 60_000L;

    private static volatile Listener listener;
    private static final Map<String, Long> RECENT = new LinkedHashMap<>();

    private CaptureIntake() {}

    static void setListener(Listener value) {
        listener = value;
    }

    /**
     * Seals and queues one message. Returns whether it was queued: false when capture is not set
     * up, the message repeats one just seen, or sealing failed (the message is then dropped —
     * there is nothing safe to do with it that the user would want).
     */
    static boolean capture(
            Context context, String channel, String sender, String title, String body, long receivedAt) {
        CaptureQueue queue = CaptureQueue.get(context);
        if (!queue.hasKey()) return false;
        if (isRepeat(channel + "|" + sender + "|" + title + "|" + body)) return false;

        try {
            JSONObject payload = new JSONObject();
            payload.put("channel", channel);
            payload.put("sender", sender);
            if (title != null && !title.isEmpty()) payload.put("title", title);
            payload.put("body", body);
            payload.put("receivedAt", receivedAt);

            String id = UUID.randomUUID().toString();
            queue.add(receivedAt, id, seal(queue, payload.toString(), id).toString());
        } catch (JSONException | GeneralSecurityException | RuntimeException e) {
            return false;
        }

        int pending = queue.count();
        Listener current = listener;
        if (current != null) current.onCaptured(pending);
        CaptureNotifier.notifyPending(context, pending);
        return true;
    }

    /** Seals {@code plaintextJson} to the stored public key and returns the queue item as JSON. */
    static JSONObject seal(CaptureQueue queue, String plaintextJson, String id)
            throws JSONException, GeneralSecurityException {
        PublicKey key = SealedBox.parsePublicKey(Base64.decode(queue.publicKey(), Base64.NO_WRAP));
        SealedBox.Sealed sealed = SealedBox.seal(key, plaintextJson.getBytes(StandardCharsets.UTF_8));
        JSONObject item = new JSONObject();
        item.put("v", 1);
        item.put("id", id);
        item.put("kid", queue.keyId());
        item.put("wk", Base64.encodeToString(sealed.wrappedKey, Base64.NO_WRAP));
        item.put("iv", Base64.encodeToString(sealed.iv, Base64.NO_WRAP));
        item.put("ct", Base64.encodeToString(sealed.ciphertext, Base64.NO_WRAP));
        return item;
    }

    private static boolean isRepeat(String fingerprint) {
        long now = System.currentTimeMillis();
        synchronized (RECENT) {
            Iterator<Map.Entry<String, Long>> it = RECENT.entrySet().iterator();
            while (it.hasNext()) {
                if (now - it.next().getValue() > DEBOUNCE_MS) it.remove();
            }
            if (RECENT.containsKey(fingerprint)) return true;
            RECENT.put(fingerprint, now);
            return false;
        }
    }
}
