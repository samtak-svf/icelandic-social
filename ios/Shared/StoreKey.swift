import Foundation
import Security

/// The 32-byte SQLCipher key for the core's store (decision 0016). It is made
/// once on this device and kept in the Keychain, readable after the first
/// unlock so the notification service can open the store while the phone is
/// locked. Never synchronised to iCloud and never in a backup that leaves the
/// device.
struct StoreKey {
    /// The Keychain access group both targets share: the App Group, which iOS
    /// accepts as an access group. Nil only in tests, which are signed
    /// ad hoc and so have no access group to share.
    let accessGroup: String?

    static let byteCount = 32
    private static let service = "spjall.store"

    enum Failure: Error {
        case keychain(OSStatus)
        case random(OSStatus)
        case corrupt(Int)
    }

    /// The key, made and stored on first use.
    func load() throws -> Data {
        if let key = try read() { return key }
        var key = Data(count: Self.byteCount)
        let status = key.withUnsafeMutableBytes {
            SecRandomCopyBytes(kSecRandomDefault, Self.byteCount, $0.baseAddress!)
        }
        guard status == errSecSuccess else { throw Failure.random(status) }
        var add = query()
        add[kSecValueData] = key
        add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(add as CFDictionary, nil)
        // Another process made it first: use theirs, never overwrite it.
        if added == errSecDuplicateItem, let theirs = try read() { return theirs }
        guard added == errSecSuccess else { throw Failure.keychain(added) }
        return key
    }

    private func read() throws -> Data? {
        var find = query()
        find[kSecReturnData] = true
        find[kSecMatchLimit] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(find as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let key = item as? Data else { throw Failure.keychain(status) }
        guard key.count == Self.byteCount else { throw Failure.corrupt(key.count) }
        return key
    }

    private func query() -> [CFString: Any] {
        var query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: Self.service,
            kSecAttrAccount: "sqlcipher",
            kSecAttrSynchronizable: false,
            kSecUseDataProtectionKeychain: true,
        ]
        if let accessGroup { query[kSecAttrAccessGroup] = accessGroup }
        return query
    }

    /// Removes the key; only tests call this.
    func delete() {
        SecItemDelete(query() as CFDictionary)
    }
}

/// Where the store lives: the App Group container, so the notification
/// service opens the same file (decision 0016), excluded from backups.
enum StoreLocation {
    enum Failure: Error { case noAppGroup }

    /// The App Group this build was signed with (Info.plist `SpjallAppGroup`).
    static var appGroup: String? {
        Bundle.main.object(forInfoDictionaryKey: "SpjallAppGroup") as? String
    }

    static func directory() throws -> URL {
        guard let group = appGroup,
            let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
        else { throw Failure.noAppGroup }
        var dir = container.appending(path: "core", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try dir.setResourceValues(values)
        return dir
    }
}
