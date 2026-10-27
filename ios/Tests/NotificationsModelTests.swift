import SpjallCore
import XCTest

@testable import Spjall

/// The ids a model asked to take off the lock screen.
private actor Cleared {
    private(set) var ids: [String] = []
    func add(_ more: [String]) { ids += more }
}

@MainActor
final class NotificationsModelTests: XCTestCase {
    private let social = FakeSocial()

    private func model(cancel: @escaping @Sendable ([String]) async -> Void = { _ in }) async -> NotificationsModel {
        social.notifications = rows
        let model = NotificationsModel(social: social, cancel: cancel)
        await model.load()
        return model
    }

    private let rows = [
        makeNotice("n3", .comment, actor: anna, post: "p1", createdAt: FakeAccount.now + 3),
        makeNotice("n2", .reaction, actor: anna, post: "p1", createdAt: FakeAccount.now + 2),
        makeNotice("n1", .joinApproved, read: true, createdAt: FakeAccount.now + 1),
    ]

    func testShowsTheNewestAndCountsTheUnread() async {
        let model = await model()
        XCTAssertEqual(model.notifications.map(\.notificationId), ["n3", "n2"])
        XCTAssertEqual(model.unread, 2)
        await model.more()
        XCTAssertEqual(model.notifications.map(\.notificationId), ["n3", "n2", "n1"])
    }

    func testAppearingMarksSeenAndReadsNothing() async {
        social.seenAt = FakeAccount.now + 1
        social.notifications = rows
        let model = NotificationsModel(social: social)
        await model.appear()
        XCTAssertTrue(social.calls.contains("seenNotifications \(FakeAccount.now + 3)"))
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("readNotifications") })
        XCTAssertEqual(model.unseen, 0)
        XCTAssertEqual(model.unread, 2)
    }

    func testRowsMadeSinceTheLastLookAreNewForTheWholeVisit() async {
        social.seenAt = FakeAccount.now + 2
        social.notifications = rows
        let model = NotificationsModel(social: social)
        await model.appear()
        XCTAssertEqual(model.fresh.map(\.notificationId), ["n3"])
        await model.more()
        XCTAssertEqual(model.earlier.map(\.notificationId), ["n2", "n1"])
        // Seen now, yet this visit keeps them where they were.
        await model.refresh()
        XCTAssertEqual(model.fresh.map(\.notificationId), ["n3"])
        // The next visit starts from the new look.
        await model.appear()
        XCTAssertTrue(model.fresh.isEmpty)
        XCTAssertEqual(model.earlier.map(\.notificationId), ["n3", "n2"])
    }

    func testAListNeverLookedAtIsAllNew() async {
        let model = await model()
        XCTAssertNil(model.seenAt)
        XCTAssertEqual(model.fresh.map(\.notificationId), ["n3", "n2"])
        XCTAssertTrue(model.earlier.isEmpty)
    }

    func testMarkAllReadReadsUpToTheNewestAndClearsTheLockScreen() async {
        let cleared = Cleared()
        let model = await model(cancel: { await cleared.add($0) })
        await model.markAllRead()
        XCTAssertTrue(social.calls.contains("readNotifications \(FakeAccount.now + 3)"))
        XCTAssertEqual(model.unread, 0)
        XCTAssertTrue(model.notifications.allSatisfy(\.read))
        let ids = await cleared.ids
        XCTAssertEqual(Set(ids), ["n3", "n2"])
    }

    func testNothingUnreadMarksNothing() async {
        social.notifications = [makeNotice("n1", .joinApproved, read: true)]
        let model = NotificationsModel(social: social)
        await model.load()
        await model.markAllRead()
        XCTAssertFalse(social.calls.contains { $0.hasPrefix("readNotifications") })
    }

    func testAFailedMarkSeenLeavesTheCount() async {
        let model = await model()
        social.failNext = unreachable
        await model.markSeen()
        XCTAssertEqual(model.unseen, 3)
        XCTAssertNil(model.problem)
    }

    func testOpeningARowReadsItAndClearsItsNotification() async {
        let cleared = Cleared()
        let model = await model(cancel: { await cleared.add($0) })
        await model.open(model.notifications[0])
        XCTAssertTrue(social.calls.contains("readNotification n3 true"))
        XCTAssertEqual(model.unread, 1)
        XCTAssertEqual(model.notifications.map(\.read), [true, false])
        let ids = await cleared.ids
        XCTAssertEqual(ids, ["n3"])
        await model.open(model.notifications[0])
        XCTAssertEqual(social.calls.filter { $0 == "readNotification n3 true" }.count, 1)
    }

    func testTheMenuMarksARowUnreadAgain() async {
        let model = await model()
        await model.more()
        await model.setRead(model.notifications[2], false)
        XCTAssertTrue(social.calls.contains("readNotification n1 false"))
        XCTAssertEqual(model.unread, 3)
        XCTAssertFalse(model.notifications[2].read)
    }

    func testTheMenuRemovesARow() async {
        let cleared = Cleared()
        let model = await model(cancel: { await cleared.add($0) })
        await model.remove(model.notifications[0])
        XCTAssertTrue(social.calls.contains("deleteNotification n3"))
        XCTAssertEqual(model.notifications.map(\.notificationId), ["n2"])
        XCTAssertEqual(model.unread, 1)
        let ids = await cleared.ids
        XCTAssertEqual(ids, ["n3"])
    }

    func testTheMenuQuietsAKindToTheAppOnlyAndACommunityOff() async {
        let model = await model()
        await model.inAppOnly(model.notifications[1])
        XCTAssertTrue(social.calls.contains("setNotificationSettings reaction:inApp"))
        await model.communityOff(model.notifications[0])
        XCTAssertTrue(social.calls.contains("setCommunityNotificationLevel k1 off"))
        XCTAssertEqual(social.settings.kinds, [NotificationKindLevel(kind: .reaction, level: .inApp)])
    }

    func testAModeratorsActionCannotBeQuieted() async {
        let model = await model()
        XCTAssertTrue(model.canQuiet(makeNotice("n", .comment)))
        XCTAssertFalse(model.canQuiet(makeNotice("n", .moderated)))
    }

    func testAFailedMenuActionLeavesTheRowAndShowsTheProblem() async {
        let model = await model()
        social.failNext = unreachable
        await model.remove(model.notifications[0])
        XCTAssertEqual(model.notifications.count, 2)
        XCTAssertNotNil(model.problem)
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
