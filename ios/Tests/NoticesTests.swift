import SpjallCore
import XCTest

@testable import Spjall

/// What the notification service shows for the core's notices (decision 0025).
final class NoticesTests: XCTestCase {
    private let anna = person("a2", "Anna Sigurðardóttir")
    private let unnamed = person("a3")
    private let labels = NoticeLabels(
        unnamed: "Ónefnd", alone: "Bara þú", photo: "Mynd", file: "Skrá", post: "Deild færsla")

    private func notice(
        _ conversation: String,
        _ seq: UInt64,
        sender: Person? = nil,
        kind: NoticeKind = .text,
        text: String? = "hæ",
        members: [Person]? = nil
    ) -> Notice {
        let sender = sender ?? anna
        return Notice(
            conversation: conversation,
            members: members ?? [sender],
            seq: seq,
            sender: sender,
            kind: kind,
            text: text,
            ts: FakeAccount.now + seq
        )
    }

    func testEachConversationIsOneAnnouncementWithItsItemsInOrder() {
        let shown = announcements(
            [notice("c1", 5, text: "ertu þarna?"), notice("c2", 9, text: "halló"), notice("c1", 4)],
            labels: labels
        )

        XCTAssertEqual(
            shown,
            [
                Announcement(conversation: "c1", title: "Anna Sigurðardóttir", body: "hæ\nertu þarna?"),
                Announcement(conversation: "c2", title: "Anna Sigurðardóttir", body: "halló"),
            ]
        )
    }

    func testAGroupNamesItsMembersAndEachSenderAndAFileWithoutACaptionSaysWhatItIs() {
        let members = [anna, unnamed]
        let shown = announcements(
            [
                notice("g", 1, kind: .photo, text: nil, members: members),
                notice("g", 2, sender: unnamed, kind: .file, text: nil, members: members),
                notice("g", 3, kind: .photo, text: "útsýnið", members: members),
                notice("alone", 1, members: []),
            ],
            labels: labels
        )

        XCTAssertEqual(shown.first?.title, "Anna Sigurðardóttir, Ónefnd")
        XCTAssertEqual(
            shown.first?.body,
            "Anna Sigurðardóttir: Mynd\nÓnefnd: Skrá\nAnna Sigurðardóttir: útsýnið"
        )
        XCTAssertEqual(shown.last, Announcement(conversation: "alone", title: "Bara þú", body: "hæ"))
    }

    func testASharedPostIsAnnouncedInAFixedSentenceAndNeverByItsText() {
        // The core gives no text for a share; one that did come is still not shown (decision 0040).
        let shown = announcements(
            [notice("c1", 1, kind: .post, text: nil), notice("c1", 2, kind: .post, text: "leyndó")],
            labels: labels
        )

        XCTAssertEqual(shown.map(\.body), ["Deild færsla\nDeild færsla"])
    }

    func testNothingNewIsNoAnnouncement() {
        XCTAssertEqual(announcements([], labels: labels), [])
    }
}
