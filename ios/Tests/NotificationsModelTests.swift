import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class NotificationsModelTests: XCTestCase {
    private let social = FakeSocial()

    private func model() async -> NotificationsModel {
        social.notifications = [
            makeNotice("n3", .comment, actor: anna, post: "p1", createdAt: FakeAccount.now + 3),
            makeNotice("n2", .reaction, actor: anna, post: "p1", createdAt: FakeAccount.now + 2),
            makeNotice("n1", .joinApproved, read: true, createdAt: FakeAccount.now + 1),
        ]
        let model = NotificationsModel(social: social)
        await model.load()
        return model
    }

    func testShowsTheNewestAndCountsTheUnread() async {
        let model = await model()
        XCTAssertEqual(model.notifications.map(\.notificationId), ["n3", "n2"])
        XCTAssertEqual(model.unread, 2)
        await model.more()
        XCTAssertEqual(model.notifications.map(\.notificationId), ["n3", "n2", "n1"])
    }

    func testOpeningMarksReadUpToTheNewest() async {
        let model = await model()
        await model.markRead()
        XCTAssertTrue(social.calls.contains("readNotifications \(FakeAccount.now + 3)"))
        XCTAssertEqual(model.unread, 0)
        XCTAssertTrue(model.notifications.allSatisfy(\.read))
    }

    func testNothingUnreadMarksNothing() async {
        social.notifications = [makeNotice("n1", .joinApproved, read: true)]
        let model = NotificationsModel(social: social)
        await model.load()
        await model.markRead()
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("readNotifications") })
    }

    func testAFailedMarkLeavesTheCount() async {
        let model = await model()
        social.failNext = unreachable
        await model.markRead()
        XCTAssertEqual(model.unread, 2)
        XCTAssertNil(model.problem)
    }

    func testARefreshTakesTheNewCountQuietly() async {
        let model = await model()
        social.notifications.insert(makeNotice("n4", .comment, actor: anna, post: "p2"), at: 0)
        await model.refresh()
        XCTAssertEqual(model.unread, 3)
        social.failNext = unreachable
        await model.refresh()
        XCTAssertEqual(model.unread, 3)
        XCTAssertNil(model.problem)
    }
}
