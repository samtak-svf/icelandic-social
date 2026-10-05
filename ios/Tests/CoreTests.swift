import Foundation
import SpjallCore
import XCTest

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

    func testStoreMigrates() throws {
        let dir = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        XCTAssertGreaterThanOrEqual(try storeSelfTest(dir: dir.path(percentEncoded: false)), 1)
    }
}
