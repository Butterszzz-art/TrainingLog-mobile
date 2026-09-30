package com.pocketcoach.instagramstories;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
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
