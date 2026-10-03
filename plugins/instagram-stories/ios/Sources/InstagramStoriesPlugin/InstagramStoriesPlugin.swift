import Foundation
import Capacitor
import Photos
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
        CAPPluginMethod(name: "share", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareImage", returnType: CAPPluginReturnPromise)
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

    /// Saves an image to Photos. WKWebView ignores <a download>, so the web
    /// "Save image" did nothing. Needs NSPhotoLibraryAddUsageDescription
    /// (codemagic.yaml adds it). Options: image (base64). Resolves { saved: true }.
    @objc func saveImage(_ call: CAPPluginCall) {
        guard let base64 = call.getString("image"), let data = Data(base64Encoded: base64),
              UIImage(data: data) != nil else {
            call.reject("image is required")
            return
        }
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized || status == .limited else {
                call.reject("Photo library access was denied", "DENIED")
                return
            }
            PHPhotoLibrary.shared().performChanges({
                PHAssetCreationRequest.forAsset().addResource(with: .photo, data: data, options: nil)
            }) { success, error in
                if success {
                    call.resolve(["saved": true])
                } else {
                    call.reject("Couldn't save the image", nil, error)
                }
            }
        }
    }

    /// Opens the system share sheet with one image. Options: image (base64).
    @objc func shareImage(_ call: CAPPluginCall) {
        guard let base64 = call.getString("image"), let data = Data(base64Encoded: base64),
              let image = UIImage(data: data) else {
            call.reject("image is required")
            return
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("No view controller")
                return
            }
            let sheet = UIActivityViewController(activityItems: [image], applicationActivities: nil)
            // iPad presents share sheets as popovers, which need an anchor.
            if let popover = sheet.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.maxY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            sheet.completionWithItemsHandler = { _, completed, _, _ in
                call.resolve(["opened": true, "completed": completed])
            }
            presenter.present(sheet, animated: true)
        }
    }
}
