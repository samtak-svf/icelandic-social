import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class ConversationModelTests: XCTestCase {
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

    private var sends: [String] { account.calls.filter { $0.hasPrefix("send ") } }
    private var reads: Int { account.calls.filter { $0 == "timeline c1 -" }.count }
    private var marks: [String] { account.calls.filter { $0.hasPrefix("markRead") } }
    private func typing(_ active: Bool) -> String { #"{"type":"typing","active":\#(active)}"# }

    func testReadsTheNewestPageAndMarksItRead() async {
        account.timelines["c1"] = [item(1), item(2)]
        let model = await model()
        XCTAssertEqual(model.conversation?.id, "c1")
        XCTAssertEqual(model.items.map(\.seq), [1, 2])
        XCTAssertFalse(model.older, "a short page is the whole timeline")
        await eventually { self.marks == ["markRead c1 2"] }
        XCTAssertEqual(account.calls.last, "sync")
    }

    func testMarksReadOnlyWhenTheNewestAdvanced() async {
        account.timelines["c1"] = [item(1)]
        let model = await model()
        await eventually { self.marks.count == 1 }
        await model.load()
        XCTAssertEqual(marks.count, 1)
        account.timelines["c1", default: []].append(item(2))
        live.emit(.timeline(conversation: "c1", changed: [2]))
        await eventually { self.marks == ["markRead c1 1", "markRead c1 2"] }
    }

    func testReadsAgainOnlyForEventsOfThisConversation() async {
        _ = await model()
        XCTAssertEqual(reads, 1)
        live.emit(.timeline(conversation: "c2", changed: [1]))
        live.emit(.expired(conversation: "c1", removed: [1]))
        await eventually { self.reads == 2 }
        live.emit(.profiles(accounts: ["a2"]))
        await eventually { self.reads == 3 }
    }

    func testSendsTextRepliesAndEdits() async {
        let target = item(4, own: true)
        account.timelines["c1"] = [target]
        let model = await model()

        model.type("  Halló  ")
        await model.send()
        model.reply(target)
        model.type("Já")
        await model.send()
        model.edit(target)
        XCTAssertEqual(model.draft, "m4")
        model.type("m4!")
        await model.send()

        XCTAssertEqual(
            sends,
            [
                "send c1 \(Body.text(text: "Halló"))",
                "send c1 \(Body.reply(to: "e4", text: "Já"))",
                "send c1 \(Body.edit(target: "e4", text: "m4!"))",
            ])
        XCTAssertEqual(model.draft, "")
        XCTAssertEqual(model.mode, .new)
        XCTAssertTrue(model.items.contains { $0.seq == nil }, "the pending item shows")
    }

    func testTheComposerAttachesWhileEmptyAndSendsOnceThereIsText() async {
        let target = item(4, own: true)
        let model = await model()
        XCTAssertEqual(model.composerAction, .attach)
        model.type("  ")
        XCTAssertEqual(model.composerAction, .attach)
        model.type("Hæ")
        XCTAssertEqual(model.composerAction, .send)
        model.type("")
        model.reply(target)
        XCTAssertEqual(model.composerAction, .send, "a reply never attaches")
        model.cancelMode()
        model.edit(target)
        model.type("")
        XCTAssertEqual(model.composerAction, .send, "send stays while editing")
    }

    func testABlankDraftSendsNothingAndCancellingAnEditClearsIt() async {
        let target = item(4, own: true)
        let model = await model()
        model.type("   ")
        await model.send()
        XCTAssertEqual(sends, [])

        model.edit(target)
        model.cancelMode()
        XCTAssertEqual(model.draft, "")
        model.reply(target)
        model.type("svar")
        model.cancelMode()
        XCTAssertEqual(model.draft, "svar")
        XCTAssertEqual(model.mode, .new)
    }

    func testDeletesAndTogglesReactions() async {
        let model = await model()
        let mine = Reaction(emoji: "👍", own: true, people: [person("a1", "Jón")])
        let theirs = Reaction(emoji: "❤️", own: false, people: [person("a2", "Anna")])
        let target = item(4, reactions: [mine, theirs])
        await model.delete(target)
        await model.react(target, "👍")
        await model.react(target, "❤️")
        XCTAssertEqual(
            sends,
            [
                "send c1 \(Body.delete(target: "e4"))",
                "send c1 \(Body.reaction(target: "e4", emoji: "👍", remove: true))",
                "send c1 \(Body.reaction(target: "e4", emoji: "❤️", remove: false))",
            ])
    }

    func testAFailedSendIsAProblemThatRetrySendsAgain() async {
        account.typingOn = false
        let model = await model()
        model.type("Halló")
        await eventually { self.account.calls.contains("typing c1 true") }
        account.failNext = unreachable
        await model.send()
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertEqual(account.timelines["c1"] ?? [], [], "nothing was queued")

        await model.retry()
        XCTAssertNil(model.problem)
        XCTAssertEqual(sends, Array(repeating: "send c1 \(Body.text(text: "Halló"))", count: 2))
        XCTAssertEqual(account.timelines["c1"]?.count, 1)
    }

    func testMutesForEachDurationAndTurnsNotificationsBackOn() async {
        let model = await model()
        await model.mute(.eightHours)
        await eventually { model.conversation?.mute == .until(at: FakeAccount.now + 8 * 3_600_000) }
        await model.mute(.always)
        await eventually { model.conversation?.mute == .always }
        await model.unmute()
        await eventually { model.conversation?.mute == .off }
        let asked = account.calls.filter { $0.hasPrefix("mute") || $0.hasPrefix("unmute") }
        XCTAssertEqual(asked, ["mute c1 eightHours", "mute c1 always", "unmute c1"])
    }

    func testAFailedMuteIsAProblemThatRetryMutesAgain() async {
        let model = await model()
        account.failNext = unreachable
        await model.mute(.hour)
        // Said, not swallowed: the person must not believe a mute that did not happen.
        XCTAssertEqual(model.problem, .unreachable)
        XCTAssertEqual(model.conversation?.mute, .off)
        await model.retry()
        XCTAssertNil(model.problem)
        await eventually { model.conversation?.mute == .until(at: FakeAccount.now + 3_600_000) }
    }

    func testResendAsksTheCoreToRetryTheOutbox() async {
        await model().resend()
        XCTAssertTrue(account.calls.contains("retry c1"))
    }

    func testTypingSendsAFrameAndStopsWhenIdle() async {
        let model = await model()
        model.type("H")
        await eventually { self.live.sent == [self.typing(true)] && self.sleeps.waiting == [.seconds(5)] }
        sleeps.pass(.seconds(5))
        await eventually { self.live.sent == [self.typing(true), self.typing(false)] }
    }

    func testSendingAndPausingStopTyping() async {
        let model = await model()
        model.type("H")
        await eventually { self.live.sent == [self.typing(true)] }
        model.paused()
        await eventually { self.live.sent.last == self.typing(false) }
        model.paused()
        await Task.yield()
        XCTAssertEqual(live.sent.count, 2, "a second pause sends nothing")

        model.type("Hæ")
        await eventually { self.live.sent.count == 3 }
        await model.send()
        await eventually { self.live.sent.last == self.typing(false) }
        XCTAssertEqual(live.sent.count, 4)
    }

    func testTypingOffInSettingsSendsNoFrame() async {
        account.typingOn = false
        let model = await model()
        model.type("H")
        await eventually { self.account.calls.contains("typing c1 true") }
        model.paused()
        XCTAssertEqual(live.sent, [])
    }

    func testTheOtherSideTypingShowsAndFades() async {
        let model = await model()
        live.emit(.typing(conversation: "c2", active: true))
        live.emit(.typing(conversation: "c1", active: true))
        await eventually { model.typing }
        await eventually { self.sleeps.waiting == [.seconds(6)] }
        sleeps.pass(.seconds(6))
        await eventually { !model.typing }
    }

    func testExpiresWhenTheFirstItemIsDue() async {
        account.timelines["c1"] = [
            item(1, expiresAt: FakeAccount.now + 2_000), item(2, expiresAt: FakeAccount.now + 9_000),
        ]
        account.expired = [Outcome(events: [.expired(conversation: "c1", removed: [1])], frames: [])]
        _ = await model()
        await eventually { self.sleeps.waiting == [.milliseconds(2_000)] }
        XCTAssertFalse(account.calls.contains("expire"))
        account.timelines["c1"]?.removeFirst()
        sleeps.pass(.milliseconds(2_000))
        await eventually { self.account.calls.contains("expire") && self.reads == 2 }
        await eventually { self.sleeps.waiting == [.milliseconds(9_000)] }
    }

    func testLoadsOlderPagesUntilTheStart() async {
        account.timelines["c1"] = (1...120).map { item(UInt64($0)) }
        let model = await model()
        XCTAssertEqual(model.items.first?.seq, 71)
        XCTAssertTrue(model.older)
        await model.loadOlder()
        XCTAssertEqual(model.items.first?.seq, 21)
        await model.loadOlder()
        XCTAssertEqual(model.items.first?.seq, 1)
        XCTAssertFalse(model.older)
        await model.loadOlder()
        XCTAssertEqual(
            account.calls.filter { $0.hasPrefix("timeline c1 ") && !$0.hasSuffix("-") }.count, 2,
            "a short page ends the paging")
    }
}
