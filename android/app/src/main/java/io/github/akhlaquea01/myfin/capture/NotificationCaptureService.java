package io.github.akhlaquea01.myfin.capture;

import android.app.Notification;
import android.content.ComponentName;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * Reads notifications from payment and banking apps, and bank-alert-looking ones from messaging
 * apps (see {@link CaptureFilter}), after the user switches on "Notification access" for MyFin in
 * Android settings. Every other app's notification is returned from immediately, without its text
 * being read. A messaging app's text is only inspected in memory and dropped unless it reads like a
 * bank alert. Never logs.
 */
public class NotificationCaptureService extends NotificationListenerService {
    /** Key of a message inside Notification.EXTRA_MESSAGES. */
    private static final String MESSAGE_TEXT_KEY = "text";

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null) return;
            String appName = CaptureFilter.paymentAppName(sbn.getPackageName());
            boolean fromMessagingApp = false;
            if (appName == null) {
                appName = CaptureFilter.messagingAppName(sbn.getPackageName());
                fromMessagingApp = appName != null;
            }
            if (appName == null) return;

            CaptureQueue queue = CaptureQueue.get(this);
            if (!queue.notificationsEnabled() || !queue.hasKey()) return;

            Notification notification = sbn.getNotification();
            if (notification == null) return;
            // A group summary repeats its children; an ongoing one is a status line, not an event.
            if ((notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
            if ((notification.flags & Notification.FLAG_ONGOING_EVENT) != 0) return;

            Bundle extras = notification.extras;
            if (extras == null) return;
            CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (text == null) text = extras.getCharSequence(Notification.EXTRA_TEXT);
            if (text == null && fromMessagingApp) text = latestMessageText(extras);
            if (text == null) return;

            String titleText = title == null ? "" : title.toString();
            String bodyText = text.toString();
            String combined = titleText + " " + bodyText;
            boolean wanted = fromMessagingApp
                    ? CaptureFilter.looksLikeBankAlert(combined)
                    : CaptureFilter.looksLikeTransaction(combined);
            if (!wanted) return;

            CaptureIntake.capture(this, "notification", appName, titleText, bodyText, sbn.getPostTime());
        } catch (RuntimeException ignored) {
            // A malformed notification must never take the listener down.
        }
    }

    /** A chat notification may carry its text only as a list of messages; take the newest. */
    @SuppressWarnings("deprecation")
    private static CharSequence latestMessageText(Bundle extras) {
        Parcelable[] messages = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
        if (messages == null || messages.length == 0) return null;
        Parcelable latest = messages[messages.length - 1];
        return latest instanceof Bundle ? ((Bundle) latest).getCharSequence(MESSAGE_TEXT_KEY) : null;
    }

    @Override
    public void onListenerDisconnected() {
        // Some phones unbind listeners when memory is tight; ask to be bound again.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            requestRebind(new ComponentName(this, NotificationCaptureService.class));
        }
    }
}
