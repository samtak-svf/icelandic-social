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

    func testAGroupsPreviewStartsWithTheSendersFirstName() {
        let sender = person("a3", "Bjarni Jónsson")
        let said = item(1, text: "Sæl", sender: sender, ts: 0)
        XCTAssertEqual(previewLine(said, group: true), "Bjarni: Sæl")
        XCTAssertEqual(previewLine(said, group: false), "Sæl")
        let own = item(2, text: "Takk", sender: sender, own: true, ts: 0)
        XCTAssertEqual(previewLine(own, group: true), "Þú: Takk")
        let deleted = item(3, sender: sender, ts: 0, content: .deleted)
        XCTAssertEqual(previewLine(deleted, group: true), lastLine(deleted))
        XCTAssertEqual(firstName(person("a4")), localized("person_unnamed"))
    }
}
