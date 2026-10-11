package io.github.akhlaquea01.myfin.capture;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * Sealed messages waiting for the app to be opened and unlocked, plus the few settings the
 * receivers need (the public sealing key and which sources are switched on). Stored in private
 * SharedPreferences. Nothing in here is readable without the web layer's private key.
 *
 * Writes use commit(), not apply(): a receiver's process can be killed right after onReceive
 * returns, and a queued message must not be lost to an asynchronous write that never happened.
 */
final class CaptureQueue {
    /** Beyond this the oldest messages are dropped (and counted) rather than growing without bound. */
    static final int MAX_ITEMS = 500;

    private static final String PREFS = "myfin_capture";
    private static final String ITEM_PREFIX = "q.";
    // "q." + 13-digit zero-padded timestamp + "." + id — sorts oldest first.
    private static final int ID_OFFSET = ITEM_PREFIX.length() + 13 + 1;

    private static final String K_PUBLIC_KEY = "publicKey";
    private static final String K_KEY_ID = "keyId";
    private static final String K_SMS = "smsEnabled";
    private static final String K_NOTIFICATIONS = "notificationsEnabled";
    private static final String K_DROPPED = "dropped";

    private static CaptureQueue instance;

    private final SharedPreferences prefs;

    private CaptureQueue(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized CaptureQueue get(Context context) {
        if (instance == null) instance = new CaptureQueue(context);
        return instance;
    }

    // ---- settings ---------------------------------------------------------------------------

    synchronized void setSealingKey(String publicKeyBase64, String keyId) {
        prefs.edit().putString(K_PUBLIC_KEY, publicKeyBase64).putString(K_KEY_ID, keyId).commit();
    }

    synchronized String publicKey() {
        return prefs.getString(K_PUBLIC_KEY, null);
    }

    synchronized String keyId() {
        return prefs.getString(K_KEY_ID, null);
    }

    synchronized boolean hasKey() {
        return publicKey() != null && keyId() != null;
    }

    synchronized void setEnabled(Boolean sms, Boolean notifications) {
        SharedPreferences.Editor editor = prefs.edit();
        if (sms != null) editor.putBoolean(K_SMS, sms);
        if (notifications != null) editor.putBoolean(K_NOTIFICATIONS, notifications);
        editor.commit();
    }

    synchronized boolean smsEnabled() {
        return prefs.getBoolean(K_SMS, false);
    }

    synchronized boolean notificationsEnabled() {
        return prefs.getBoolean(K_NOTIFICATIONS, false);
    }

    // ---- queue ------------------------------------------------------------------------------

    /** Adds a sealed item (its JSON), dropping the oldest ones if the queue is full. */
    synchronized void add(long receivedAt, String id, String itemJson) {
        TreeMap<String, String> items = items();
        SharedPreferences.Editor editor = prefs.edit();
        int dropped = prefs.getInt(K_DROPPED, 0);
        while (items.size() >= MAX_ITEMS) {
            String oldest = items.firstKey();
            items.remove(oldest);
            editor.remove(oldest);
            dropped++;
        }
        editor.putInt(K_DROPPED, dropped);
        editor.putString(ITEM_PREFIX + String.format(Locale.ROOT, "%013d", Math.max(0L, receivedAt)) + "." + id, itemJson);
        editor.commit();
    }

    /** The oldest items, as JSON, up to {@code limit}. */
    synchronized List<String> list(int limit) {
        List<String> out = new ArrayList<>();
        for (String json : items().values()) {
            if (out.size() >= limit) break;
            out.add(json);
        }
        return out;
    }

    synchronized int count() {
        return items().size();
    }

    /** Removes the items with these ids and returns how many were removed. */
    synchronized int remove(Collection<String> ids) {
        Set<String> wanted = new HashSet<>(ids);
        SharedPreferences.Editor editor = prefs.edit();
        int removed = 0;
        for (String key : items().keySet()) {
            if (key.length() > ID_OFFSET && wanted.contains(key.substring(ID_OFFSET))) {
                editor.remove(key);
                removed++;
            }
        }
        editor.commit();
        return removed;
    }

    synchronized int dropped() {
        return prefs.getInt(K_DROPPED, 0);
    }

    synchronized void resetDropped() {
        prefs.edit().putInt(K_DROPPED, 0).commit();
    }

    /** Forgets everything: queue, key, switches. Used when all app data is cleared. */
    synchronized void clearAll() {
        prefs.edit().clear().commit();
    }

    private TreeMap<String, String> items() {
        TreeMap<String, String> items = new TreeMap<>();
        for (Map.Entry<String, ?> entry : prefs.getAll().entrySet()) {
            if (entry.getKey().startsWith(ITEM_PREFIX) && entry.getValue() instanceof String) {
                items.put(entry.getKey(), (String) entry.getValue());
            }
        }
        return items;
    }
}
