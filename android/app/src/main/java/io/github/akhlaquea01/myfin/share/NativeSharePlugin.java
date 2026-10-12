package io.github.akhlaquea01.myfin.share;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.appcompat.app.AppCompatActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

/**
 * Receives what other apps share into MyFin through Android's share sheet (text such as a bank
 * SMS, an image such as a receipt, or a CSV/Excel bank statement). The PWA does this with a service worker, which does not
 * exist inside the Android app, so the share arrives here as an ACTION_SEND intent instead.
 *
 * The share is held in memory only — never written to disk — until the web layer takes it with
 * {@code consume()}, which it does after unlock, so a share made while the app is locked simply
 * waits. An image is read when it is consumed, not when it arrives, so a slow content provider
 * cannot stall the main thread.
 */
@CapacitorPlugin(name = "NativeShare")
public class NativeSharePlugin extends Plugin {
    /** Larger than any receipt photo worth keeping; the web layer compresses what it accepts. */
    private static final long MAX_IMAGE_BYTES = 10L * 1024L * 1024L;

    /** The import screen refuses files above this size anyway; stop reading well before memory hurts. */
    private static final long MAX_STATEMENT_BYTES = 10L * 1024L * 1024L;

    /**
     * Set by MainActivity when it is being recreated after the system killed it. The intent it
     * then reports is the ORIGINAL launch intent, and replaying an old share would be wrong.
     */
    private static volatile boolean ignoreLaunchIntent = false;

    private static final class Pending {
        final String text;
        final String subject;
        final Uri stream;
        final String mimeType;

        Pending(String text, String subject, Uri stream, String mimeType) {
            this.text = text;
            this.subject = subject;
            this.stream = stream;
            this.mimeType = mimeType;
        }
    }

    private Pending pending;

    public static void setRestoredFromSavedState(boolean restored) {
        ignoreLaunchIntent = restored;
    }

    @Override
    public void load() {
        AppCompatActivity activity = getActivity();
        if (activity != null && !ignoreLaunchIntent) hold(activity.getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (hold(intent)) notifyListeners("shared", new JSObject());
    }

    /** Hands over the waiting share, once. Resolves {@code {pending:false}} when there is none. */
    @PluginMethod
    public void consume(PluginCall call) {
        Pending taken;
        synchronized (this) {
            taken = pending;
            pending = null;
        }
        JSObject result = new JSObject();
        if (taken == null) {
            result.put("pending", false);
            call.resolve(result);
            return;
        }

        JSObject payload = new JSObject();
        if (taken.text != null) payload.put("text", taken.text);
        if (taken.subject != null) payload.put("subject", taken.subject);
        if (taken.stream != null) {
            if (isStatementType(taken.mimeType)) {
                ImageRead file = readStatement(taken.stream, taken.mimeType);
                if (file.payload != null) payload.put("file", file.payload);
                else payload.put("fileProblem", file.problem);
            } else {
                ImageRead image = readImage(taken.stream, taken.mimeType);
                if (image.payload != null) payload.put("image", image.payload);
                else payload.put("imageProblem", image.problem);
            }
        }
        result.put("pending", true);
        result.put("payload", payload);
        call.resolve(result);
    }

    /** Remembers a share intent. Returns whether it was one worth remembering. */
    private boolean hold(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return false;
        // Re-opened from the recents list: the intent is the old one, not a new share.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return false;

        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        CharSequence subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
        String type = intent.getType();
        boolean hasFile = type != null && (type.startsWith("image/") || isStatementType(type));
        Uri stream = hasFile ? streamOf(intent) : null;
        if (text == null && subject == null && stream == null) return false;

        synchronized (this) {
            pending = new Pending(
                    text == null ? null : text.toString(),
                    subject == null ? null : subject.toString(),
                    stream,
                    type);
        }
        return true;
    }

    /** CSV and Excel files — what a bank's "download statement" produces. */
    private static boolean isStatementType(String type) {
        if (type == null) return false;
        String t = type.toLowerCase(Locale.ROOT);
        return t.equals("text/csv")
                || t.equals("text/comma-separated-values")
                || t.equals("application/csv")
                || t.equals("application/vnd.ms-excel")
                || t.equals("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }

    private static Uri streamOf(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        @SuppressWarnings("deprecation")
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return uri;
    }

    private static final class ImageRead {
        final JSObject payload;
        final String problem;

        ImageRead(JSObject payload, String problem) {
            this.payload = payload;
            this.problem = problem;
        }
    }

    private ImageRead readImage(Uri uri, String declaredType) {
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) return new ImageRead(null, "unreadable");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_IMAGE_BYTES) return new ImageRead(null, "too-large");
                bytes.write(buffer, 0, read);
            }

            String type = resolver.getType(uri);
            if (type == null || !type.startsWith("image/")) {
                type = declaredType != null && declaredType.startsWith("image/") && !declaredType.endsWith("/*")
                        ? declaredType
                        : "image/jpeg";
            }
            JSObject image = new JSObject();
            image.put("name", displayName(resolver, uri, "shared-image"));
            image.put("mimeType", type);
            image.put("base64", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
            return new ImageRead(image, null);
        } catch (IOException | RuntimeException e) {
            return new ImageRead(null, "unreadable");
        }
    }

    /** Reads a shared CSV/Excel file. The file name matters: the import screen tells Excel from CSV by extension. */
    private ImageRead readStatement(Uri uri, String declaredType) {
        ContentResolver resolver = getContext().getContentResolver();
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) return new ImageRead(null, "unreadable");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_STATEMENT_BYTES) return new ImageRead(null, "too-large");
                bytes.write(buffer, 0, read);
            }

            String type = resolver.getType(uri);
            if (!isStatementType(type)) type = declaredType;
            boolean excel = type != null && type.toLowerCase(Locale.ROOT).contains("spreadsheetml");
            String name = displayName(resolver, uri, excel ? "statement.xlsx" : "statement.csv");
            if (excel && !name.toLowerCase(Locale.ROOT).endsWith(".xlsx")) name = name + ".xlsx";

            JSObject file = new JSObject();
            file.put("name", name);
            file.put("mimeType", type == null ? "text/csv" : type);
            file.put("base64", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
            return new ImageRead(file, null);
        } catch (IOException | RuntimeException e) {
            return new ImageRead(null, "unreadable");
        }
    }

    private static String displayName(ContentResolver resolver, Uri uri, String fallback) {
        try (Cursor cursor = resolver.query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String name = cursor.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (RuntimeException ignored) {
            // Fall through to the generic name.
        }
        return fallback;
    }
}
