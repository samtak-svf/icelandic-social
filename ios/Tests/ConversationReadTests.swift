import SpjallCore
import XCTest

@testable import Spjall

/// When the conversation's model marks it read: only what a person saw, and only forward (#554).
@MainActor
final class ConversationReadTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private lazy var live = FakeLive(account: account)
    private var following: [Task<Void, Never>] = []

    override func tearDown() async throws {
        following.forEach { $0.cancel() }
    }

    /// A model whose screen is in front, as the view leaves it, unless `shown` is false.
    private func model(shown: Bool = true) async -> ConversationModel {
        account.list = [conversation("c1", members: [person("a2", "Anna")])]
        let model = ConversationModel(id: "c1", account: account, live: live)
        if shown { model.visible(true) }
        following.append(Task { await model.follow() })
        await eventually { model.loaded }
        return model
    }

    private var marks: [String] { account.calls.filter { $0.hasPrefix("markRead") } }

    private func arrives(_ seq: UInt64) {
        account.timelines["c1", default: []].append(item(seq))
        live.emit(.timeline(conversation: "c1", changed: [seq]))
    }

    func testMarksReadOnlyWhenTheNewestAdvanced() async {
        account.timelines["c1"] = [item(1)]
        let model = await model()
        await eventually { self.marks.count == 1 }
        await model.load()
        XCTAssertEqual(marks.count, 1)
        arrives(2)
        await eventually { self.marks == ["markRead c1 1", "markRead c1 2"] }
    }

    func testAMessageThatArrivesInTheBackgroundIsLoadedButNotRead() async {
        account.timelines["c1"] = [item(1)]
        let model = await model()
        await eventually { self.marks == ["markRead c1 1"] }
        model.visible(false)
        arrives(2)
        // The read that loads it decides on the mark before it returns, so the items prove it decided.
        await eventually { model.items.map(\.seq) == [1, 2] }
        XCTAssertEqual(marks, ["markRead c1 1"], "nobody saw it, so the sender is not told it was read")
        model.visible(true)
        await eventually { self.marks == ["markRead c1 1", "markRead c1 2"] }
    }

    func testNothingIsReadBeforeTheScreenIsInFront() async {
        account.timelines["c1"] = [item(1)]
        let model = await model(shown: false)
        XCTAssertEqual(marks, [])
        XCTAssertFalse(account.calls.contains("sync"))
        model.visible(true)
        await eventually { self.marks == ["markRead c1 1"] && self.account.calls.last == "sync" }
    }

    func testTheMarkerGatesOnShownMovesOnlyForwardAndGivesBackAFailedClaim() async {
        let sent = Sent()
        let reader = ReadMarker { seq in
            sent.seqs.append(seq)
            if sent.failing { throw unreachable }
        }
        await reader.read([item(1)])
        XCTAssertEqual(sent.seqs, [], "nothing is marked while the screen is not in front")
        reader.shown = true
        sent.failing = true
        await reader.read([item(1)])
        sent.failing = false
        await reader.read([item(1)])
        await reader.read([item(1)])
        await reader.read([item(2), item(1)])
        XCTAssertEqual(sent.seqs, [1, 1, 2], "a failed mark is tried again, a sent one never")
    }
}

/// What a test `ReadMarker` was asked to mark.
@MainActor
private final class Sent {
    var seqs: [UInt64] = []
    var failing = false
}
