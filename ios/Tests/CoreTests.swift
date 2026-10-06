import Foundation
import SpjallCore
import XCTest

@testable import Spjall

/// The Rust core loads and works in the simulator (decision 0002).
final class CoreTests: XCTestCase {
    func testVersion() {
        XCTAssertFalse(coreVersion().isEmpty)
        XCTAssertEqual(envelopeVersion(), 1)
    }

    func testEnvelopeRoundTrip() throws {
        let envelope = Envelope(id: "m1", ts: 1_790_000_000_000, body: .text(text: "halló"))
        XCTAssertEqual(try envelopeDecode(bytes: envelopeEncode(envelope: envelope)), envelope)
    }

    func testMlsGroupOfTwo() throws {
        XCTAssertEqual(try mlsSelfTest(), 1)
    }

    /// The store opens with its Keychain key, and only with it (decision 0016).
    func testStoreOpensWithItsKeyOnly() throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let storeKey = StoreKey(accessGroup: nil)
        storeKey.delete()
        defer { storeKey.delete() }

        let key = try storeKey.load()
        XCTAssertEqual(key.count, StoreKey.byteCount)
        XCTAssertEqual(try storeKey.load(), key)

        let path = dir.path(percentEncoded: false)
        XCTAssertGreaterThanOrEqual(try CoreStore.open(dir: path, key: key).schemaVersion(), 1)
        XCTAssertThrowsError(try CoreStore.open(dir: path, key: Data(repeating: 7, count: 32)))
    }
}
