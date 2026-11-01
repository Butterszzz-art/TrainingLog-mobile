import Foundation
import UIKit
import Capacitor
import AuthenticationServices
import CryptoKit

/// Sign in with Apple, for Firebase.
/// JS side: src/js/apple-sign-in.js.
///
/// authorize({ rawNonce, scopes? }) shows Apple's sheet. The SHA-256 of
/// rawNonce goes to Apple; Firebase later checks the raw one against the
/// identity token. Resolves { identityToken, authorizationCode, user, email,
/// givenName, familyName }. Cancelling rejects with code "CANCELLED".
///
/// Needs the com.apple.developer.applesignin entitlement
/// (scripts/ios/add-capabilities.rb).
@objc(SignInWithApplePlugin)
public class SignInWithApplePlugin: CAPPlugin, CAPBridgedPlugin,
    ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    public let identifier = "SignInWithApplePlugin"
    public let jsName = "SignInWithApple"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorize", returnType: CAPPluginReturnPromise)
    ]

    private var pending: CAPPluginCall?
    private var controller: ASAuthorizationController?

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    @objc func authorize(_ call: CAPPluginCall) {
        guard let rawNonce = call.getString("rawNonce"), !rawNonce.isEmpty else {
            return call.reject("rawNonce is required")
        }
        let wantScopes = call.getBool("scopes") ?? true
        DispatchQueue.main.async {
            // Only one sheet at a time.
            self.pending?.reject("Another sign-in started", "CANCELLED")
            self.pending = call

            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = wantScopes ? [.fullName, .email] : []
            request.nonce = SignInWithApplePlugin.sha256(rawNonce)

            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            self.controller = controller
            controller.performRequests()
        }
    }

    private static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let window = bridge?.webView?.window { return window }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap { $0.windows }.first { $0.isKeyWindow } ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithAuthorization authorization: ASAuthorization) {
        defer { pending = nil; self.controller = nil }
        guard let call = pending else { return }
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let identityToken = String(data: tokenData, encoding: .utf8) else {
            return call.reject("Apple didn't return an identity token", "FAILED")
        }
        let code = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        // Apple sends the name and email only the first time someone signs in.
        call.resolve([
            "identityToken": identityToken,
            "authorizationCode": code ?? NSNull(),
            "user": credential.user,
            "email": credential.email ?? NSNull(),
            "givenName": credential.fullName?.givenName ?? NSNull(),
            "familyName": credential.fullName?.familyName ?? NSNull()
        ])
    }

    public func authorizationController(controller: ASAuthorizationController,
                                        didCompleteWithError error: Error) {
        defer { pending = nil; self.controller = nil }
        guard let call = pending else { return }
        if let authError = error as? ASAuthorizationError, authError.code == .canceled {
            call.reject("Sign in with Apple was cancelled", "CANCELLED")
        } else {
            call.reject(error.localizedDescription, "FAILED")
        }
    }
}
