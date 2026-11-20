// swift-tools-version: 5.9
import PackageDescription

// The package and product name must match what the Capacitor CLI derives
// from the npm name ("capacitor-speech-to-text" -> CapacitorSpeechToText).
let package = Package(
    name: "CapacitorSpeechToText",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorSpeechToText",
            targets: ["SpeechToTextPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "SpeechToTextPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/SpeechToTextPlugin",
            linkerSettings: [.linkedFramework("Speech"), .linkedFramework("AVFoundation")])
    ]
)
