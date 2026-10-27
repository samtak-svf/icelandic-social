import SpjallCore
import XCTest

@testable import Spjall

/// The plural keys resolve through the string catalog, which only the app bundle carries.
final class StringsTests: XCTestCase {
    func testAPluralTakesTheFormForItsCount() {
        XCTAssertEqual(plural("group_member_count", 1), "1 meðlimur")
        XCTAssertEqual(plural("group_member_count", 21), "21 meðlimur")
        XCTAssertEqual(plural("group_member_count", 2), "2 meðlimir")
        XCTAssertEqual(plural("unread_count", 1), "1 ólesin")
        XCTAssertEqual(plural("reaction_count", 1), "1 viðbragð")
        XCTAssertEqual(plural("reaction_count", 3), "3 viðbrögð")
    }

    func testTheHostedScreensPluralsAndNames() {
        XCTAssertEqual(plural("post_comments", 1), "1 athugasemd")
        XCTAssertEqual(plural("post_comments", 3), "3 athugasemdir")
        XCTAssertEqual(plural("community_members", 1), "1 meðlimur")
        XCTAssertEqual(plural("community_members", 2), "2 meðlimir")
        XCTAssertEqual(plural("notifications_unread", 1), "1 ólesin")
        XCTAssertEqual(plural("notifications_unread", 4), "4 ólesnar")
        XCTAssertEqual(localized("notice_comment", "Anna"), "Anna skrifaði athugasemd við póstinn þinn.")
        XCTAssertEqual(localized("notice_reaction", "Anna"), "Anna brást við póstinum þínum.")
    }

    func testCopyAndALinksActionResolve() {
        XCTAssertEqual(localized("copy"), "Afrita")
        XCTAssertEqual(localized("copied"), "Afritað")
        XCTAssertEqual(localized("link_open", "www.example.com"), "Opna www.example.com")
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

    func testASharedPostIsListedInFixedWordsAsSaidByItsSender() {
        let share = item(1, own: true, ts: 0, content: .post(postId: "p1"))
        XCTAssertEqual(lastLine(share), localized("post_shared"))
        XCTAssertEqual(previewLine(share, group: false), "Þú: Deild færsla")
    }

    func testALocationIsListedInAFixedWordAndNeverByItsPlace() {
        let place = item(1, own: true, ts: 0, content: .location(latE6: 64_141_960, lonE6: -21_926_570, accuracy: nil))
        XCTAssertEqual(lastLine(place), localized("location"))
        XCTAssertEqual(previewLine(place, group: false), localized("last_line_own", localized("location")))
    }

    func testALocationsCardNamesTheCoordinatesByTheirSidesAndTheAccuracyWhenThereIsOne() {
        let reykjavik = placeLinks(latE6: 64_141_960, lonE6: -21_926_570)
        XCTAssertEqual(
            coordinatesLine(reykjavik),
            localized(
                "location_coordinates", localized("location_north", "64,14196"),
                localized("location_west", "21,92657")))
        let sydney = placeLinks(latE6: -33_856_800, lonE6: 151_215_300)
        XCTAssertEqual(
            coordinatesLine(sydney),
            localized(
                "location_coordinates", localized("location_south", "33,85680"),
                localized("location_east", "151,21530")))
        XCTAssertEqual(accuracyLine(12), localized("location_accuracy", 12))
        XCTAssertNil(accuracyLine(nil))
    }

    func testAFixIsSentInRoundedMicrodegreesWithItsAccuracyInWholeMetres() {
        XCTAssertEqual(
            locationBody(latitude: 64.1419604, longitude: -21.9265696, accuracy: 11.6),
            .location(latE6: 64_141_960, lonE6: -21_926_570, accuracy: 12))
        XCTAssertEqual(
            locationBody(latitude: 0, longitude: 0, accuracy: -1),
            .location(latE6: 0, lonE6: 0, accuracy: nil), "a negative accuracy is none")
    }

    func testAnUnreadableRowIsListedInItsFixedLine() {
        let row = item(1, own: false, ts: 0, content: .unreadable(code: "envelope/malformed"))
        XCTAssertEqual(lastLine(row), localized("item_unreadable"))
        XCTAssertEqual(previewLine(row, group: false), localized("item_unreadable"))
    }
}

/// The `_many` notification keys are a plural on the count of the OTHER actors, with the newest actor's name
/// as a first argument (`%1$@ og %2$lld …`): the catalogue must pick the form by the count, not the name.
final class ManyPluralTests: XCTestCase {
    private func many(_ key: String, _ name: String, _ count: Int) -> String {
        String.localizedStringWithFormat(NSLocalizedString(key, comment: ""), name, count)
    }

    func testTheOtherActorsCountPicksTheFormAndBothArgumentsLand() {
        XCTAssertEqual(
            many("notice_comment_many", "Anna", 1), "Anna og 1 annar skrifuðu athugasemdir við póstinn þinn.")
        XCTAssertEqual(
            many("notice_comment_many", "Anna", 2), "Anna og 2 aðrir skrifuðu athugasemdir við póstinn þinn.")
        XCTAssertEqual(
            many("notice_comment_many", "Anna", 21), "Anna og 21 annar skrifuðu athugasemdir við póstinn þinn.")
        XCTAssertEqual(many("notice_reaction_many", "Anna", 18), "Anna og 18 aðrir brugðust við póstinum þínum.")
        XCTAssertEqual(many("notice_reply_many", "Anna", 21), "Anna og 21 annar svöruðu athugasemdinni þinni.")
    }
}
