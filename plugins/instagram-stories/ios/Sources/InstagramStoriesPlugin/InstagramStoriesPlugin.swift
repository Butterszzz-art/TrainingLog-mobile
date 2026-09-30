import Foundation
import Capacitor
import UIKit

/// Shares to Instagram Stories the way Meta documents it: the images go on
/// the pasteboard under Instagram's keys, then the instagram-stories://
/// URL opens the story composer with them.
/// https://developers.facebook.com/docs/instagram-platform/sharing-to-stories/
///
/// Needs `instagram-stories` in LSApplicationQueriesSchemes (codemagic.yaml
/// adds it), otherwise canOpenURL always returns false.
@objc(InstagramStoriesPlugin)
public class InstagramStoriesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InstagramStoriesPlugin"
    public let jsName = "InstagramStories"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise)
    ]

    private static let pasteboardTTL: TimeInterval = 60 * 5

    @objc func isAvailable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let url = URL(string: "instagram-stories://share")!
            call.resolve(["available": UIApplication.shared.canOpenURL(url)])
        }
    }

    /// Options: appId (required), stickerImage / backgroundImage (base64,
    /// at least one), backgroundTopColor / backgroundBottomColor (hex, used
    /// when there is no background image).
    @objc func share(_ call: CAPPluginCall) {
        guard let appId = call.getString("appId"), !appId.isEmpty,
              let url = URL(string: "instagram-stories://share?source_application=\(appId)") else {
            call.reject("appId is required")
            return
        }

        var item: [String: Any] = [:]
        if let sticker = call.getString("stickerImage"), let data = Data(base64Encoded: sticker) {
            item["com.instagram.sharedSticker.stickerImage"] = data
        }
        if let background = call.getString("backgroundImage"), let data = Data(base64Encoded: background) {
            item["com.instagram.sharedSticker.backgroundImage"] = data
        } else {
            if let top = call.getString("backgroundTopColor") {
                item["com.instagram.sharedSticker.backgroundTopColor"] = top
            }
            if let bottom = call.getString("backgroundBottomColor") {
                item["com.instagram.sharedSticker.backgroundBottomColor"] = bottom
            }
        }
        guard item["com.instagram.sharedSticker.stickerImage"] != nil
                || item["com.instagram.sharedSticker.backgroundImage"] != nil else {
            call.reject("stickerImage or backgroundImage is required")
            return
        }

        DispatchQueue.main.async {
            guard UIApplication.shared.canOpenURL(url) else {
                call.reject("Instagram is not installed", "UNAVAILABLE")
                return
            }
            UIPasteboard.general.setItems(
                [item],
                options: [.expirationDate: Date().addingTimeInterval(Self.pasteboardTTL)]
            )
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve()
                } else {
                    call.reject("Couldn't open Instagram")
                }
            }
        }
    }
}
