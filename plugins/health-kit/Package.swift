// swift-tools-version: 5.9
import PackageDescription

// The package and product name must match what the Capacitor CLI derives
// from the npm name ("capacitor-health-kit" -> CapacitorHealthKit).
let package = Package(
    name: "CapacitorHealthKit",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorHealthKit",
            targets: ["HealthKitPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "HealthKitPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/HealthKitPlugin",
            linkerSettings: [.linkedFramework("HealthKit")])
    ]
)
