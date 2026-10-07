import XCTest

@testable import Spjall

/// The plural keys resolve through the string catalog, which only the app bundle carries.
final class StringsTests: XCTestCase {
    func testAPluralTakesTheFormForItsCount() {
        XCTAssertEqual(plural("unread_count", 1), "1 ólesið")
        XCTAssertEqual(plural("unread_count", 2), "2 ólesin")
    }

    func testATimerIsWholeDaysOrElseHours() {
        XCTAssertEqual(duration(86_400), "1 dag")
        XCTAssertEqual(duration(7 * 86_400), "7 daga")
        XCTAssertEqual(duration(3_600), "1 klukkustund")
        XCTAssertEqual(duration(90_000), "25 klukkustundir")
    }
}
