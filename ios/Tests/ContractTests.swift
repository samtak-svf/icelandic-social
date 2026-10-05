import Foundation
import SpjallAPI
import XCTest

/// The generated Swift types read what the Worker writes (api/openapi.json).
final class ContractTests: XCTestCase {
    func testHealthDecodes() throws {
        let body = Data(#"{"status":"ok","minClientVersion":{"android":"1.4.0","ios":"1.3.0"}}"#.utf8)
        let health = try JSONDecoder().decode(Health.self, from: body)
        XCTAssertEqual(health.status, .ok)
        XCTAssertEqual(health.minClientVersion.ios, "1.3.0")
        XCTAssertEqual(health.minClientVersion.android, "1.4.0")
    }
}
