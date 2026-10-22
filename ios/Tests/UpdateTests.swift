import XCTest

@testable import Spjall

@MainActor
final class UpdateTests: XCTestCase {
    func testTrimsServerUpdateURL() {
        let update = Update()
        update.required("0.9.0", url: "  https://example.com/optin\n")

        XCTAssertEqual(update.min, "0.9.0")
        XCTAssertEqual(update.url, "https://example.com/optin")
    }

    func testMissingOrBlankServerUpdateURLIsNil() {
        let update = Update()
        update.required("0.9.0")
        XCTAssertNil(update.url)

        update.required("0.9.1", url: "  \n")
        XCTAssertNil(update.url)
    }
}
