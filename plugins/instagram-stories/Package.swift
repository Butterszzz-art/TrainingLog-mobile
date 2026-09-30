// swift-tools-version: 5.9
import PackageDescription

// The package and product name must match what the Capacitor CLI derives
// from the npm name ("capacitor-instagram-stories" -> CapacitorInstagramStories).
let package = Package(
    name: "CapacitorInstagramStories",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorInstagramStories",
            targets: ["InstagramStoriesPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "InstagramStoriesPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/InstagramStoriesPlugin")
    ]
)
