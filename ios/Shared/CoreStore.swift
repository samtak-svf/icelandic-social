import Foundation
import SpjallCore

/// The core on this device's store (decision 0016), talking to the API host
/// this build names. The app and the notification service open the same one.
enum CoreStore {
    struct NoAPIHost: Error {}

    /// The API host this build names (Info.plist `SpjallAPIHost`).
    static let apiBase: URL? = (Bundle.main.object(forInfoDictionaryKey: "SpjallAPIHost") as? String)
        .flatMap { URL(string: "https://\($0)") }

    static func open() throws -> CoreClient {
        guard let base = apiBase else { throw NoAPIHost() }
        let dir = try StoreLocation.directory()
        let key = try StoreKey(accessGroup: StoreLocation.appGroup).load()
        return try CoreClient.open(
            dir: dir.path(percentEncoded: false),
            key: key,
            transport: URLSessionTransport(baseURL: base)
        )
    }
}
