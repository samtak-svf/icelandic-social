// swift-tools-version:6.0
// The HTTP client, generated at build time from api/openapi.json (decision
// 0005) by swift-openapi-generator's build plugin; nothing generated is
// committed. Sources/SpjallAPI/openapi.json is a symlink to that file.
import PackageDescription

let package = Package(
    name: "SpjallAPI",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [.library(name: "SpjallAPI", targets: ["SpjallAPI"])],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.10.0"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.1.0"),
        // The generated code names HTTPTypes itself, so the target links it
        // directly; reaching it only through the runtime leaves its symbols
        // undefined at link time.
        .package(url: "https://github.com/apple/swift-http-types", from: "1.0.0"),
    ],
    targets: [
        .target(
            name: "SpjallAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
            ],
            plugins: [.plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator")]
        )
    ]
)
