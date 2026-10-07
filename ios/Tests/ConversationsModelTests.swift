import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class ConversationsModelTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private lazy var live = FakeLive(account: account)

    private var reads: Int { account.calls.filter { $0 == "conversations" }.count }

    func testShowsTheListAndNoEmptyStateBeforeTheFirstRead() async {
        account.list = [conversation("c1", members: [person("a2", "Anna")])]
        let model = ConversationsModel(account: account, live: live)
        XCTAssertFalse(model.loaded)
        await model.load()
        XCTAssertTrue(model.loaded)
        XCTAssertEqual(model.conversations.map(\.id), ["c1"])
    }

    func testReadsAgainOnEachEventButTyping() async {
        let model = ConversationsModel(account: account, live: live)
        let following = Task { await model.follow() }
        await eventually { self.reads == 1 }

        live.emit(.typing(conversation: "c1", active: true))
        account.list = [conversation("c1", members: [person("a2")], unread: 1)]
        live.emit(.timeline(conversation: "c1", changed: [1]))
        await eventually { model.conversations.first?.unread == 1 }
        XCTAssertEqual(reads, 2)

        live.finish()
        await following.value
    }

    func testAFailedReadShowsTheProblemUntilAReadWorks() async {
        let model = ConversationsModel(account: account, live: live)
        account.failNext = unreachable
        await model.load()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertTrue(model.loaded)
        await model.load()
        XCTAssertNil(model.problem)
    }

    func testShowsTheSocketsConnection() {
        let model = ConversationsModel(account: account, live: live)
        XCTAssertEqual(model.connection, .connecting)
        live.connection = .offline
        XCTAssertEqual(model.connection, .offline)
    }

    func testAnInviteOpensANewOneToOneAndSyncs() async {
        account.invites["t1"] = "a2"
        let model = ConversationsModel(account: account, live: live)
        let opened = await model.openInvite(token: "t1")
        XCTAssertEqual(opened, "c1")
        XCTAssertEqual(model.conversations.map(\.id), ["c1"])
        XCTAssertEqual(live.performed, 1)
    }

    func testAnInviteFromSomeoneMetOpensTheOneToOneThereIs() async {
        account.invites["t1"] = "a2"
        account.list = [conversation("old", members: [person("a2")])]
        let opened = await ConversationsModel(account: account, live: live).openInvite(token: "t1")
        XCTAssertEqual(opened, "old")
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("createConversation") })
    }

    func testADeadInviteSaysSoUntilTheNextOne() async {
        let model = ConversationsModel(account: account, live: live)
        let dead = await model.openInvite(token: "gone")
        XCTAssertNil(dead)
        XCTAssertTrue(model.inviteExpired)
        XCTAssertNil(model.problem)

        account.invites["t1"] = "a2"
        _ = await model.openInvite(token: "t1")
        XCTAssertFalse(model.inviteExpired)
    }

    func testOwnOrTheOperatorsInviteOpensNothingAndShowsNothing() async {
        account.invites["mine"] = "a1"
        account.failNext = CoreError.Invalid(detail: "own invite")
        let model = ConversationsModel(account: account, live: live)
        let opened = await model.openInvite(token: "mine")
        XCTAssertNil(opened)
        XCTAssertNil(model.problem)
        XCTAssertFalse(model.inviteExpired)
    }

    func testAnUnreachableServerShowsTheProblem() async {
        account.failNext = unreachable
        let model = ConversationsModel(account: account, live: live)
        _ = await model.openInvite(token: "t1")
        XCTAssertEqual(model.problem, .unreachable)
    }
}
