import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class PickModelTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private lazy var live = FakeLive(account: account)

    private var forwards: [String] { account.calls.filter { $0.hasPrefix("forward ") } }

    /// A forward of seq 7 out of c1, as the conversation screen asks for it (decision 0041).
    private func model() async -> PickModel {
        let model = PickModel(
            account: account,
            live: live,
            except: "c1",
            sleep: { _ in },
            preview: { _ in Outgoing.message(item(7, text: "Sjáumst á morgun")) }
        ) { account, to in
            _ = try account.forward("c1", seq: 7, to: to)
        }
        await model.load()
        return model
    }

    func testOffersEveryConversationItCanSendIntoButTheOneItCameFrom() async {
        account.list = [
            conversation("c1", members: [person("a2", "Anna")]),
            conversation("c2", members: [person("a3", "Björn")]),
            conversation("c3", members: [person("a4", "Dóra")], state: .removed),
            conversation("c4", members: [person("a5", "Elín")], state: .new),
        ]
        let model = await model()
        XCTAssertEqual(model.conversations.map(\.id), ["c2", "c4"])
        XCTAssertTrue(model.loaded)
    }

    func testSendsOneCopyIntoEachPickedConversationThenSaysHowMany() async {
        account.list = ["c2", "c3", "c4"].map { conversation($0, members: [person("a2")]) }
        let model = await model()
        XCTAssertFalse(model.canSend)
        model.toggle("c4")
        model.toggle("c2")
        model.toggle("c3")
        model.toggle("c3")
        XCTAssertEqual(model.picked, ["c4", "c2"])
        XCTAssertTrue(model.canSend)
        await model.send()
        // In the list's order, not the order they were picked in.
        XCTAssertEqual(forwards, ["forward c1 7 c2", "forward c1 7 c4"])
        XCTAssertEqual(live.performed, 1)
        XCTAssertEqual(model.done, 2)
    }

    func testAFailedForwardKeepsOnlyWhatWasNotSentPickedSoTryingAgainSendsNoCopyTwice() async {
        account.list = ["c2", "c3"].map { conversation($0, members: [person("a2")]) }
        let model = await model()
        model.toggle("c2")
        model.toggle("c3")
        account.failOn = "forward c1 7 c3"
        await model.send()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertEqual(model.picked, ["c3"])
        XCTAssertFalse(model.sending)
        XCTAssertNil(model.done)
        // What did go is sent, even though the rest failed.
        XCTAssertEqual(live.performed, 1)

        account.failOn = nil
        await model.send()
        XCTAssertNil(model.problem)
        XCTAssertEqual(forwards, ["forward c1 7 c2", "forward c1 7 c3", "forward c1 7 c3"])
        XCTAssertEqual(model.done, 2)
    }

    func testNothingPickedSendsNothing() async {
        account.list = [conversation("c2", members: [person("a2")])]
        let model = await model()
        await model.send()
        XCTAssertTrue(forwards.isEmpty)
        XCTAssertEqual(live.performed, 0)
    }

    func testAFailedReadIsAProblemThatRetryClears() async {
        account.failNext = unreachable
        let model = await model()
        XCTAssertEqual(model.problem, .unreachable)
        await model.retry()
        XCTAssertNil(model.problem)
    }

    func testAMessageIsForwardedButNotOneUnderATimerNorACardNorASharedPost() {
        XCTAssertTrue(Offer(item(1)).forward)
        XCTAssertFalse(Offer(item(2, expiresAt: FakeAccount.now + 60_000)).forward, "a copy would outlive it")
        XCTAssertFalse(Offer(item(3, content: .deleted)).forward)
        XCTAssertFalse(Offer(item(nil)).forward, "not sent yet")
        XCTAssertFalse(Offer(item(4, content: .post(postId: "p1"))).forward, "a shared post (decision 0044)")
        XCTAssertTrue(Offer(item(4, content: .post(postId: "p1"))).reply, "but it can be answered")
    }

    func testTheConversationForwardsFromItselfAndOnlyWhatItMayForward() async {
        account.list = [
            conversation("c1", members: [person("a2", "Anna")]),
            conversation("c2", members: [person("a3", "Björn")]),
        ]
        let conversation = ConversationModel(id: "c1", account: account, live: live)
        XCTAssertNil(conversation.forwarding(item(2, expiresAt: FakeAccount.now + 60_000)))
        guard let model = conversation.forwarding(item(7)) else { return XCTFail("a message is forwardable") }
        await model.load()
        XCTAssertEqual(model.conversations.map(\.id), ["c2"])
        XCTAssertEqual(model.outgoing, .message(item(7)))
        model.toggle("c2")
        await model.send()
        XCTAssertEqual(forwards, ["forward c1 7 c2"])
    }

    func testShowsTheMessageBeingForwarded() async {
        account.list = [conversation("c2", members: [person("a3", "Björn")])]
        let model = await model()
        XCTAssertEqual(model.outgoing, .message(item(7, text: "Sjáumst á morgun")))
    }

    func testASearchFindsByNameAmongWhatCanBeSentInto() async {
        account.list = [
            conversation("c1", members: [person("a2", "Anna")]),
            conversation("c2", members: [person("a3", "Björn")]),
            conversation("c3", members: [person("a4", "Anna Dóra")], state: .removed),
            conversation("c4", members: [person("a5", "Anna Sif")]),
        ]
        let model = await model()
        XCTAssertEqual(model.shown.map(\.id), ["c2", "c4"])
        model.query = " Anna "
        await model.search()
        XCTAssertTrue(account.calls.contains("searchConversations Anna"))
        // Not the one it came from, nor one it cannot send into.
        XCTAssertEqual(model.found?.map(\.id), ["c4"])
        XCTAssertEqual(model.shown.map(\.id), ["c4"])

        model.query = ""
        await model.search()
        XCTAssertNil(model.found)
        XCTAssertEqual(model.shown.map(\.id), ["c2", "c4"])
    }

    func testASearchThatFindsNothingSaysSo() async {
        account.list = [conversation("c2", members: [person("a3", "Björn")])]
        let model = await model()
        model.query = "Zeta"
        await model.search()
        XCTAssertEqual(model.found, [])
        XCTAssertTrue(model.shown.isEmpty)
    }

    func testAFailedSearchIsAProblemThatRetrySearchesAgain() async {
        account.list = [conversation("c2", members: [person("a3", "Björn")])]
        let model = await model()
        model.query = "Bj"
        account.failOn = "searchConversations Bj"
        await model.search()
        XCTAssertEqual(model.problem, .unreachable)
        account.failOn = nil
        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.found?.map(\.id), ["c2"])
    }
}
