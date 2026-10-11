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

    func testASearchWaitsForTheTypingToPauseThenFindsConversationsAndPeopleNoneTwice() async {
        let thordis = person("a2", "Þórdís Ýr")
        account.list = [
            conversation("c1", members: [thordis]),
            conversation("c2", members: [person("a3", "Sóley Bergs-Þórsdóttir")]),
        ]
        account.everyone = [thordis, person("a4", "Þórunn Halla")]
        let sleep = FakeSleep()
        let model = ConversationsModel(account: account, live: live, sleep: sleep.sleep)
        model.query = "Þ"
        let first = Task { await model.search() }
        await eventually { sleep.waiting.count == 1 }
        first.cancel()
        await first.value
        model.query = "Þór"
        let second = Task { await model.search() }
        await eventually { sleep.waiting == [.milliseconds(300)] }
        XCTAssertTrue(model.searching)
        sleep.pass(.milliseconds(300))
        await second.value

        // One search, for what was typed last, in one call; the hyphenated surname counts as a word.
        let asked = account.calls.filter { $0.hasPrefix("search") || $0.hasPrefix("directory") }
        XCTAssertEqual(asked, ["searchList Þór"])
        XCTAssertEqual(model.found?.conversations.map(\.id), ["c1", "c2"])
        // Þórdís's 1:1 is among the conversations, so she is not among the people too (decision 0038).
        XCTAssertEqual(model.found?.people.map(\.account), ["a4"])
        XCTAssertFalse(model.searching)

        model.query = " "
        await model.search()
        XCTAssertNil(model.found)
        XCTAssertFalse(model.searched)
    }

    func testAPersonFoundOpensTheirOneToOneAndSyncs() async {
        let model = ConversationsModel(account: account, live: live)
        let opened = await model.openPerson("a4")
        XCTAssertNotNil(opened)
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("openDirect") }, ["openDirect a4"])
        XCTAssertEqual(live.performed, 1)
    }

    func testAFailedSearchShowsTheProblemAndRetrySearchesAgain() async {
        let model = ConversationsModel(account: account, live: live, sleep: { _ in })
        model.query = "Anna"
        account.failNext = unreachable
        await model.search()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertFalse(model.searching)
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(account.calls.filter { $0.hasPrefix("searchList") }.count, 2)
        XCTAssertEqual(model.found?.query, "Anna")
    }

    func testARowSaysSomeoneIsTypingUntilTheyStopOrTheFrameRunsOut() async {
        let sleep = FakeSleep()
        let model = ConversationsModel(account: account, live: live, sleep: sleep.sleep)
        let following = Task { await model.follow() }
        await eventually { self.reads == 1 }

        live.emit(.typing(conversation: "c1", active: true))
        live.emit(.typing(conversation: "c2", active: true))
        await eventually { model.typing == ["c1", "c2"] }
        live.emit(.typing(conversation: "c1", active: false))
        await eventually { model.typing == ["c2"] }
        // A typing frame is no reason to read the list again.
        XCTAssertEqual(reads, 1)

        // As long as the conversation shows it, then no longer.
        await eventually { sleep.waiting == [ConversationModel.typingShown] }
        sleep.pass(ConversationModel.typingShown)
        await eventually { model.typing.isEmpty }

        live.finish()
        await following.value
    }

    func testALongPressMutesAndUnmutesWithTheCoresCallsAndReadsTheListAgain() async {
        account.list = [conversation("c1", members: [person("a2")])]
        let model = ConversationsModel(account: account, live: live)
        await model.load()
        await model.mute("c1", for: .hour)
        XCTAssertEqual(model.conversations.first?.mute, .until(at: FakeAccount.now + 3_600_000))
        await model.unmute("c1")
        XCTAssertEqual(model.conversations.first?.mute, .off)
        let asked = account.calls.filter { $0.hasPrefix("mute") || $0.hasPrefix("unmute") }
        XCTAssertEqual(asked, ["mute c1 hour", "unmute c1"])
        XCTAssertEqual(reads, 3)
    }

    func testAFailedMuteIsAProblem() async {
        account.list = [conversation("c1", members: [person("a2")])]
        let model = ConversationsModel(account: account, live: live)
        await model.load()
        account.failNext = unreachable
        await model.mute("c1", for: .always)
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertEqual(model.conversations.first?.mute, .off)
    }

    func testTheReadersOwnLastMessageSaysWhoReadIt() {
        let sent = item(1, text: "Takk", own: true, readBy: 2)
        XCTAssertEqual(readLine(sent, group: false), localized("read_marker"))
        XCTAssertEqual(readLine(sent, group: true), plural("read_by_count", 2))
        // Unread, someone else's, or not yet sent: nothing to say.
        XCTAssertNil(readLine(item(1, own: true), group: false))
        XCTAssertNil(readLine(item(1, own: false, readBy: 1), group: false))
        XCTAssertNil(readLine(item(1, own: true, status: .pending, readBy: 1), group: false))
    }
}
