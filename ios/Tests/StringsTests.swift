import XCTest

@testable import Spjall

/// The plural keys resolve through the string catalog, which only the app bundle carries.
final class StringsTests: XCTestCase {
    func testAPluralTakesTheFormForItsCount() {
        XCTAssertEqual(plural("group_member_count", 1), "1 meðlimur")
        XCTAssertEqual(plural("group_member_count", 21), "21 meðlimur")
        XCTAssertEqual(plural("group_member_count", 2), "2 meðlimir")
        XCTAssertEqual(plural("unread_count", 1), "1 ólesin")
    }

    func testATimerIsWholeDaysOrElseHours() {
        XCTAssertEqual(duration(86_400), "1 dag")
        XCTAssertEqual(duration(7 * 86_400), "7 daga")
        XCTAssertEqual(duration(3_600), "1 klukkustund")
        XCTAssertEqual(duration(90_000), "25 klukkustundir")
    }
}
