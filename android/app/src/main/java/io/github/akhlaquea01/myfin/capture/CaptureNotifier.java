package io.github.akhlaquea01.myfin.capture;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import io.github.akhlaquea01.myfin.R;

/**
 * The one alert MyFin posts: "N new transactions to review". It says how many are waiting and
 * nothing else — no amount, no merchant — and is marked private so the lock screen shows only a
 * generic line. One fixed notification id, updated in place, so a burst of messages is one alert.
 */
final class CaptureNotifier {
    private static final String CHANNEL_ID = "capture_review";
    private static final int NOTIFICATION_ID = 7101;

    /** Set while the app is on screen; the page tells the user itself, so no alert is needed. */
    private static volatile boolean appInForeground = false;

    private CaptureNotifier() {}

    static void setAppInForeground(boolean foreground) {
        appInForeground = foreground;
    }

    static boolean isAppInForeground() {
        return appInForeground;
    }

    static void notifyPending(Context context, int pending) {
        if (pending <= 0 || appInForeground) return;
        try {
            Context app = context.getApplicationContext();
            NotificationManagerCompat manager = NotificationManagerCompat.from(app);
            if (!manager.areNotificationsEnabled()) return;
            ensureChannel(app);

            Intent launch = app.getPackageManager().getLaunchIntentForPackage(app.getPackageName());
            PendingIntent open = null;
            if (launch != null) {
                launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                open = PendingIntent.getActivity(
                        app, 0, launch, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            }

            String text = pending == 1
                    ? "1 new transaction to review"
                    : pending + " new transactions to review";
            Notification publicVersion = new NotificationCompat.Builder(app, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_myfin)
                    .setContentTitle("MyFin")
                    .setContentText("Transactions to review")
                    .build();
            Notification notification = new NotificationCompat.Builder(app, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_stat_myfin)
                    .setContentTitle("MyFin")
                    .setContentText(text)
                    .setContentIntent(open)
                    .setAutoCancel(true)
                    .setOnlyAlertOnce(true)
                    .setCategory(NotificationCompat.CATEGORY_STATUS)
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .setPublicVersion(publicVersion)
                    .build();
            manager.notify(NOTIFICATION_ID, notification);
        } catch (SecurityException e) {
            // POST_NOTIFICATIONS not granted: the queue still fills, and the app shows the new
            // entries the next time it is opened.
        }
    }

    static void cancel(Context context) {
        NotificationManagerCompat.from(context.getApplicationContext()).cancel(NOTIFICATION_ID);
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "New transactions", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Tells you how many captured transactions are waiting in Review.");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        manager.createNotificationChannel(channel);
    }
}
