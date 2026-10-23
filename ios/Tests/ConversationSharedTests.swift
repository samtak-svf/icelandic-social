import SpjallCore
import XCTest

@testable import Spjall

/// The photos and files the information screen lists (decision 0055), on the conversation's own model.
@MainActor
final class ConversationSharedTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private let sleeps = FakeSleep()
    private lazy var live = FakeLive(account: account)
    private var following: [Task<Void, Never>] = []

    override func tearDown() async throws {
        following.forEach { $0.cancel() }
    }

    private func model() async -> ConversationModel {
        account.list = [conversation("c1", members: [person("a2", "Anna")])]
        let model = ConversationModel(
            id: "c1", account: account, live: live, sleep: sleeps.sleep, now: { FakeAccount.now })
        following.append(Task { await model.follow() })
        await eventually { model.loaded }
        return model
    }

    private func photo(_ seq: UInt64) -> Item {
        item(seq, content: .media(mime: "image/jpeg", size: 10, caption: nil, name: nil))
    }

    private func file(_ seq: UInt64) -> Item {
        item(seq, content: .media(mime: "application/pdf", size: 10, caption: nil, name: "skýrsla.pdf"))
    }

    func testTheConversationAloneAsksForNone() async {
        account.timelines["c1"] = [photo(1)]
        let model = await model()
        XCTAssertNil(model.shared)
        XCTAssertFalse(account.calls.contains { $0.hasPrefix("shared") })
    }

    func testTheInformationScreenListsThemNewestFirst() async {
        account.timelines["c1"] = [photo(1), item(2), file(3), photo(4)]
        let model = await model()
        await model.loadShared()
        XCTAssertEqual(model.shared?.loaded, true)
        XCTAssertEqual(model.shared?.items.map(\.seq), [4, 3, 1])
        XCTAssertEqual(model.shared?.more, false, "a short page is all of them")
        XCTAssertEqual(model.shared?.items.map(\.photo), [true, false, true])
    }

    func testAnEventReadsThemAgain() async {
        account.timelines["c1"] = [photo(1)]
        let model = await model()
        await model.loadShared()
        account.timelines["c1", default: []].append(file(2))
        live.emit(.timeline(conversation: "c1", changed: [2]))
        await eventually { model.shared?.items.map(\.seq) == [2, 1] }
        account.timelines["c1"]?.removeAll { $0.seq == 1 }
        live.emit(.expired(conversation: "c1", removed: [1]))
        await eventually { model.shared?.items.map(\.seq) == [2] }
    }

    func testOlderOnesComeAPageAtATime() async {
        account.timelines["c1"] = (1...70).map { photo(UInt64($0)) }
        let model = await model()
        await model.loadShared()
        XCTAssertEqual(model.shared?.items.count, 50)
        XCTAssertEqual(model.shared?.more, true)
        await model.moreShared()
        XCTAssertEqual(model.shared?.items.map(\.seq), (1...70).reversed().map { UInt64($0) })
        XCTAssertEqual(model.shared?.more, false)
        XCTAssertTrue(account.calls.contains("shared c1 21"))
    }

    func testEachMuteSaysItsState() {
        XCTAssertEqual(muteLine(.off), localized("mute_off"))
        XCTAssertEqual(muteLine(.until(at: FakeAccount.now)), localized("muted_until", clockTime(FakeAccount.now)))
        XCTAssertEqual(muteLine(.always), localized("muted_always"))
        XCTAssertNotEqual(muteLine(.off), muteLine(.always))
    }
}

/// A shared post card resolves through `cards`, once (decision 0080, #288).
@MainActor
final class SharedCardModelTests: XCTestCase {
    private let social = FakeSocial()

    private func reference(_ id: String) -> CardRef { CardRef(kind: .post, id: id) }

    private func card(_ id: String) -> Card {
        .post(
            reference: reference(id), community: CardCommunity(communityId: "k1", name: "Fuglar"),
            author: anna, excerpt: "Fyrsti haninn", image: nil, createdAt: FakeAccount.now)
    }

    func testAPostResolvesToItsCard() async {
        social.cards = ["p1": card("p1")]
        let model = SharedCardModel(social: social, postId: "p1")
        XCTAssertNil(model.card)
        await model.load()
        XCTAssertEqual(model.card, card("p1"))
        XCTAssertFalse(model.gone)
    }

    func testAPostThatIsGoneIsUnavailable() async {
        let model = SharedCardModel(social: social, postId: "p9")
        await model.load()
        XCTAssertTrue(model.gone)
    }

    func testItAsksTheServerOncePerCard() async {
        social.cards = ["p1": card("p1")]
        let model = SharedCardModel(social: social, postId: "p1")
        await model.load()
        await model.load()
        XCTAssertEqual(social.calls.filter { $0.hasPrefix("cards") }.count, 1)
    }

    func testAFailedReadLeavesTheCardForTheNextDraw() async {
        social.cards = ["p1": card("p1")]
        let model = SharedCardModel(social: social, postId: "p1")
        social.failNext = unreachable
        await model.load()
        XCTAssertNil(model.card)
        XCTAssertFalse(model.gone)
        await model.load()
        XCTAssertEqual(model.card, card("p1"))
    }
}
