// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Cybara",
    platforms: [
        .macOS(.v14),
    ],
    products: [
        .executable(name: "Cybara", targets: ["Cybara"]),
    ],
    targets: [
        .executableTarget(
            name: "Cybara",
            path: "Sources/Cybara",
            resources: [
                .process("Resources"),
            ]
        ),
        .testTarget(
            name: "CybaraTests",
            dependencies: ["Cybara"],
            path: "Tests/CybaraTests"
        ),
    ]
)
