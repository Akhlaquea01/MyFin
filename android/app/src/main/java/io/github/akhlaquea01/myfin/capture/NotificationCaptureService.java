package io.github.akhlaquea01.myfin.capture;

import android.app.Notification;
import android.content.ComponentName;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/**
 * Reads notifications from payment and banking apps (the ones in {@link CaptureFilter}) after the
 * user switches on "Notification access" for MyFin in Android settings. Every other app's
 * notification is returned from immediately, without its text being read. Never logs.
 */
public class NotificationCaptureService extends NotificationListenerService {
    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            if (sbn == null) return;
            String appName = CaptureFilter.paymentAppName(sbn.getPackageName());
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
            if (text == null) return;

            String titleText = title == null ? "" : title.toString();
            String bodyText = text.toString();
            if (!CaptureFilter.looksLikeTransaction(titleText + " " + bodyText)) return;

            CaptureIntake.capture(this, "notification", appName, titleText, bodyText, sbn.getPostTime());
        } catch (RuntimeException ignored) {
            // A malformed notification must never take the listener down.
        }
    }

    @Override
    public void onListenerDisconnected() {
        // Some phones unbind listeners when memory is tight; ask to be bound again.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            requestRebind(new ComponentName(this, NotificationCaptureService.class));
        }
    }
}
