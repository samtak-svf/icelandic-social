import SpjallCore
import UserNotifications
import XCTest

@testable import Spjall

/// A social notification as a lock-screen alert (decision 0107).
@MainActor
final class SocialPushTests: XCTestCase {
    private func social(
        _ id: String, _ kind: SocialNotificationKind = .comment, post: String? = "p1", community: String = "k1"
    ) -> SocialNotice {
        SocialNotice(
            notificationId: id, kind: kind, actors: [anna], actorCount: 1, communityId: community, postId: post,
            commentId: nil, action: nil, emoji: nil, createdAt: FakeAccount.now)
    }

    private func chat() -> Notice {
        Notice(
            conversation: "c1", members: [person("a2", "Anna")], seq: 4, sender: person("a2", "Anna"), kind: .text,
            text: "hæ", ts: FakeAccount.now)
    }

    private func notices(shown: [Notice] = [], social: [SocialNotice] = [], socialCleared: [String] = []) -> Notices {
        Notices(shown: shown, cleared: [], social: social, socialCleared: socialCleared)
    }

    func testASocialNoticeBecomesAnAlertWhenNoConversationHasNews() {
        let contents = pushContents(notices(social: [social("n1"), social("n2", .reply)]), labels: .brand, sound: nil)
        XCTAssertEqual(contents.map(\.threadIdentifier), ["n1", "n2"])
        XCTAssertEqual(contents[0].userInfo as? [String: String], ["community": "k1", "post": "p1"])
    }

    func testAChatAnnouncementWinsOverSocialOnes() {
        let contents = pushContents(notices(shown: [chat()], social: [social("n1")]), labels: .brand, sound: nil)
        XCTAssertEqual(contents.map(\.threadIdentifier), ["c1"])
    }

    func testNothingNewIsNoAlert() {
        XCTAssertTrue(pushContents(notices(), labels: .brand, sound: nil).isEmpty)
    }

    func testTheAlertSaysWhatTheRowSaysAndNoSnippet() {
        let notice = social("n1")
        let row = makeNotice("n1", .comment, actor: anna, post: "p1", snippet: "a private line")
        let content = pushContents(notices(social: [notice]), labels: .brand, sound: nil)[0]
        XCTAssertEqual(content.body, noticeWording(row).sentence)
        XCTAssertFalse(content.body.contains("a private line"))
        XCTAssertTrue(content.title.isEmpty)
    }

    func testAModeratedNoticeOpensTheCommunityNotThePost() {
        let moderated = notices(social: [social("n1", .moderated, post: "p1")])
        let content = pushContents(moderated, labels: .brand, sound: nil)[0]
        XCTAssertEqual(content.userInfo as? [String: String], ["community": "k1"])
        let row = makeNotice("n1", .moderated, post: "p1")
        XCTAssertEqual(noticeRoute(row), .community("k1"))
    }

    func testAPostlessNoticeOpensTheCommunity() {
        let postless = notices(social: [social("n1", .joinApproved, post: nil)])
        let content = pushContents(postless, labels: .brand, sound: nil)[0]
        XCTAssertEqual(content.userInfo as? [String: String], ["community": "k1"])
    }

    func testClearedSocialIdsLeaveWithTheConversationsOnes() {
        var all = notices(socialCleared: ["n7"])
        all.cleared = ["c2"]
        XCTAssertEqual(clearedThreads(all), ["c2", "n7"])
    }

    func testATapOpensItsTargetOnce() {
        let model = PushModel(account: FakeAccount(signedIn: true), notifier: FakeNotifier())
        model.tappedSocial(post: "p1", community: "k1")
        XCTAssertEqual(model.takeOpenedSocial(), SocialTap(post: "p1", community: "k1"))
        XCTAssertNil(model.takeOpenedSocial())
        XCTAssertNil(model.opened)
    }
}
