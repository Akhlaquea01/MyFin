package io.github.akhlaquea01.myfin.capture;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Catches incoming SMS, even when the app is closed. Does as little as possible: join the parts
 * of a long message, drop anything that cannot be about money (so an ordinary personal text is
 * never stored), and hand the rest to {@link CaptureIntake}, which seals it. Never logs.
 */
public class SmsReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;

        CaptureQueue queue = CaptureQueue.get(context);
        if (!queue.smsEnabled() || !queue.hasKey()) return;

        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;

        // A long SMS arrives in several parts; join the parts from each sender.
        Map<String, StringBuilder> bySender = new LinkedHashMap<>();
        long receivedAt = System.currentTimeMillis();
        for (SmsMessage part : parts) {
            if (part == null) continue;
            String sender = part.getOriginatingAddress();
            if (sender == null) continue;
            StringBuilder body = bySender.get(sender);
            if (body == null) {
                body = new StringBuilder();
                bySender.put(sender, body);
            }
            String text = part.getMessageBody();
            if (text != null) body.append(text);
            long stamp = part.getTimestampMillis();
            if (stamp > 0) receivedAt = stamp;
        }

        for (Map.Entry<String, StringBuilder> entry : bySender.entrySet()) {
            String sender = entry.getKey();
            String body = entry.getValue().toString();
            if (!CaptureFilter.isCandidateSms(sender, body)) continue;
            CaptureIntake.capture(context, "sms", sender, null, body, receivedAt);
        }
    }
}
