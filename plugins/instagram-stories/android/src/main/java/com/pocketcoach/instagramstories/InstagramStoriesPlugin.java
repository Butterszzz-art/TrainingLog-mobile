package com.pocketcoach.instagramstories;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/**
 * Shares to Instagram Stories with Meta's ADD_TO_STORY intent: the
 * background goes in as the intent data, the sticker as
 * interactive_asset_uri. Both are content:// URIs from the app's
 * FileProvider (authority ${applicationId}.fileprovider, which already
 * exposes the cache dir).
 * https://developers.facebook.com/docs/instagram-platform/sharing-to-stories/
 */
@CapacitorPlugin(name = "InstagramStories")
public class InstagramStoriesPlugin extends Plugin {

    private static final String INSTAGRAM = "com.instagram.android";
    private static final String ACTION = "com.instagram.share.ADD_TO_STORY";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", isInstagramInstalled());
        call.resolve(result);
    }

    /**
     * Options: appId (required), stickerImage / backgroundImage (base64, at
     * least one), backgroundTopColor / backgroundBottomColor (hex, used when
     * there is no background image).
     */
    @PluginMethod
    public void share(PluginCall call) {
        String appId = call.getString("appId");
        String sticker = call.getString("stickerImage");
        String background = call.getString("backgroundImage");
        if (appId == null || appId.isEmpty()) {
            call.reject("appId is required");
            return;
        }
        if (sticker == null && background == null) {
            call.reject("stickerImage or backgroundImage is required");
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }

        try {
            Intent intent = new Intent(ACTION);
            intent.putExtra("source_application", appId);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            if (background != null) {
                Uri bgUri = writeImage(background, "background.jpg");
                intent.setDataAndType(bgUri, "image/jpeg");
            } else {
                intent.setType("image/png");
                String top = call.getString("backgroundTopColor");
                String bottom = call.getString("backgroundBottomColor");
                if (top != null) intent.putExtra("top_background_color", top);
                if (bottom != null) intent.putExtra("bottom_background_color", bottom);
            }

            if (sticker != null) {
                Uri stickerUri = writeImage(sticker, "sticker.png");
                intent.putExtra("interactive_asset_uri", stickerUri);
                activity.grantUriPermission(INSTAGRAM, stickerUri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }

            if (activity.getPackageManager().resolveActivity(intent, 0) == null) {
                call.reject("Instagram is not installed", "UNAVAILABLE");
                return;
            }
            activity.runOnUiThread(() -> {
                try {
                    activity.startActivity(intent);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("Couldn't open Instagram", e);
                }
            });
        } catch (IOException | IllegalArgumentException e) {
            call.reject("Couldn't prepare the images", e);
        }
    }

    /**
     * Saves an image to the gallery (Pictures/Pocket Coach). The WebView
     * ignores <a download> and has no navigator.share, so the web "Save
     * image" did nothing on Android. Options: image (base64), fileName,
     * mimeType. Resolves { saved: true }, or { shared: true } on Android 9
     * and older, where writing to shared storage needs a permission we don't
     * ask for — the share sheet (with "Save to device"/Photos) opens instead.
     */
    @PluginMethod
    public void saveImage(PluginCall call) {
        String image = call.getString("image");
        String fileName = call.getString("fileName", "pocket-coach.png");
        String mimeType = call.getString("mimeType", "image/png");
        if (image == null || image.isEmpty()) {
            call.reject("image is required");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            openShareSheet(call, image, fileName, mimeType, true);
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        values.put(MediaStore.Images.Media.MIME_TYPE, mimeType);
        values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Pocket Coach");
        values.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri uri = null;
        try {
            uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new IOException("MediaStore insert failed");
            try (OutputStream out = resolver.openOutputStream(uri)) {
                if (out == null) throw new IOException("Couldn't open " + uri);
                out.write(Base64.decode(image, Base64.DEFAULT));
            }
            values.clear();
            values.put(MediaStore.Images.Media.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            JSObject result = new JSObject();
            result.put("saved", true);
            call.resolve(result);
        } catch (IOException | IllegalArgumentException | SecurityException e) {
            if (uri != null) resolver.delete(uri, null, null);
            call.reject("Couldn't save the image", e);
        }
    }

    /** Opens the system share sheet with one image. Options: image (base64), fileName, mimeType. */
    @PluginMethod
    public void shareImage(PluginCall call) {
        String image = call.getString("image");
        if (image == null || image.isEmpty()) {
            call.reject("image is required");
            return;
        }
        openShareSheet(call, image, call.getString("fileName", "pocket-coach.png"), call.getString("mimeType", "image/png"), false);
    }

    private void openShareSheet(PluginCall call, String image, String fileName, String mimeType, boolean fromSave) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity");
            return;
        }
        try {
            Uri uri = writeImage(image, fileName);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mimeType);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, null);
            activity.runOnUiThread(() -> {
                try {
                    activity.startActivity(chooser);
                    JSObject result = new JSObject();
                    result.put(fromSave ? "shared" : "opened", true);
                    call.resolve(result);
                } catch (Exception e) {
                    call.reject("Couldn't open the share sheet", e);
                }
            });
        } catch (IOException | IllegalArgumentException e) {
            call.reject("Couldn't prepare the image", e);
        }
    }

    private boolean isInstagramInstalled() {
        try {
            getContext().getPackageManager().getPackageInfo(INSTAGRAM, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private Uri writeImage(String base64, String name) throws IOException {
        Context context = getContext();
        File dir = new File(context.getCacheDir(), "instagram-stories");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Couldn't create " + dir);
        File file = new File(dir, name);
        byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        return FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
    }
}
