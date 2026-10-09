import Foundation
import SpjallCore

/// The core on this device's store (decision 0016), talking to the API host
/// this build names. The app and the notification service open the same one.
enum CoreStore {
    struct NoAPIHost: Error {}

    /// The API host this build names (Info.plist `SpjallAPIHost`).
    static let apiBase: URL? = (Bundle.main.object(forInfoDictionaryKey: "SpjallAPIHost") as? String)
        .flatMap { URL(string: "https://\($0)") }

    /// This build's version (`MARKETING_VERSION`), which the core names in
    /// every request (decision 0030).
    static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0"

    /// The `Spjall-Client` value the core sends; the socket sends it too.
    static var client: String { "ios/\(version)" }

    static func open() throws -> CoreClient {
        guard let base = apiBase else { throw NoAPIHost() }
        let dir = try StoreLocation.directory()
        let key = try StoreKey(accessGroup: StoreLocation.appGroup).load()
        let transport = URLSessionTransport(baseURL: base) { min in
            Task { @MainActor in Update.shared.required(min) }
        }
        return try CoreClient.open(
            dir: dir.path(percentEncoded: false),
            key: key,
            transport: transport,
            platform: .ios,
            version: version
        )
    }
}
