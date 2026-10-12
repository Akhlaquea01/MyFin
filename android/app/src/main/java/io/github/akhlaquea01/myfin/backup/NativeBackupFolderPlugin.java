package io.github.akhlaquea01.myfin.backup;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.OutputStream;
import java.util.regex.Pattern;

/**
 * Lets MyFin save its encrypted backup into a folder the user picks, on a schedule.
 *
 * Inside the Android WebView there is no File System Access API, so the web build's "automatic
 * backup to a folder" cannot work here. Android's Storage Access Framework can: the user chooses a
 * folder once (Documents, a cloud-synced folder, an SD card), Android remembers the grant, and this
 * plugin creates a new file in it whenever the web layer asks. Nothing but the already-encrypted
 * backup text ever reaches this class — the PIN and the data key stay in the web layer — and no
 * storage permission is needed: access is limited to the one folder the user chose.
 */
@CapacitorPlugin(name = "NativeBackupFolder")
public class NativeBackupFolderPlugin extends Plugin {
    private static final int READ_WRITE =
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    /** What the web layer names backup files; anything else is refused rather than escaped. */
    private static final Pattern SAFE_FILE_NAME = Pattern.compile("[A-Za-z0-9._-]{1,100}");

    /** Opens Android's folder picker. Resolves {@code {uri, name}}; rejects with code "cancelled". */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(READ_WRITE | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "onFolderPicked");
    }

    @ActivityCallback
    private void onFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("No folder was chosen.", "cancelled");
            return;
        }
        Uri tree = data.getData();
        try {
            // Without this the grant ends when the app is closed, and the next scheduled backup
            // would find the folder locked.
            getContext().getContentResolver().takePersistableUriPermission(tree, READ_WRITE);
        } catch (RuntimeException e) {
            call.reject("Android would not keep access to that folder.", "permission", e);
            return;
        }
        JSObject chosen = new JSObject();
        chosen.put("uri", tree.toString());
        chosen.put("name", folderName(tree));
        call.resolve(chosen);
    }

    /** Whether Android still lets MyFin write to the folder (the user can revoke it in settings). */
    @PluginMethod
    public void checkAccess(PluginCall call) {
        String uri = call.getString("uri");
        JSObject result = new JSObject();
        result.put("ok", uri != null && hasWriteAccess(getContext().getContentResolver(), Uri.parse(uri)));
        call.resolve(result);
    }

    /**
     * Creates {@code filename} in the chosen folder holding the given base64 bytes. A file that
     * could not be written completely is deleted again, so a half-written backup never sits in
     * the folder looking like a good one.
     */
    @PluginMethod
    public void writeFile(PluginCall call) {
        final String uri = call.getString("uri");
        final String filename = call.getString("filename");
        final String base64 = call.getString("base64");
        if (uri == null || filename == null || base64 == null) {
            call.reject("uri, filename and base64 are required.");
            return;
        }
        if (!SAFE_FILE_NAME.matcher(filename).matches()) {
            call.reject("That file name is not allowed.");
            return;
        }
        // Off the main thread: a backup can be several megabytes and a cloud-backed folder is slow.
        getBridge().execute(() -> {
            try {
                write(Uri.parse(uri), filename, base64);
                call.resolve();
            } catch (IOException | RuntimeException e) {
                call.reject("Could not write the backup file.", "write-failed", e);
            }
        });
    }

    private void write(Uri tree, String filename, String base64) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        if (!hasWriteAccess(resolver, tree)) throw new IOException("Access to the folder was removed.");

        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        Uri parent = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        Uri file = DocumentsContract.createDocument(resolver, parent, "application/json", filename);
        if (file == null) throw new IOException("The folder would not accept a new file.");

        boolean complete = false;
        try (OutputStream out = resolver.openOutputStream(file, "wt")) {
            if (out == null) throw new IOException("The new file could not be opened.");
            out.write(bytes);
            out.flush();
            complete = true;
        } finally {
            if (!complete) {
                try {
                    DocumentsContract.deleteDocument(resolver, file);
                } catch (RuntimeException | java.io.FileNotFoundException ignored) {
                    // Nothing more can be done; the next run reports the failure.
                }
            }
        }
    }

    private static boolean hasWriteAccess(ContentResolver resolver, Uri tree) {
        for (UriPermission permission : resolver.getPersistedUriPermissions()) {
            if (permission.getUri().equals(tree) && permission.isWritePermission()) return true;
        }
        return false;
    }

    private String folderName(Uri tree) {
        try {
            Uri document = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor cursor = getContext().getContentResolver().query(
                    document, new String[] {DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    String name = cursor.getString(0);
                    if (name != null && !name.isEmpty()) return name;
                }
            }
        } catch (RuntimeException ignored) {
            // Fall through to the generic name.
        }
        return "Chosen folder";
    }
}
