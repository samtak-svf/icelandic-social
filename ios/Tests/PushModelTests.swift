import Foundation
import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class PushModelTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private let notifier = FakeNotifier()
    private var defaults: UserDefaults!

    override func setUp() async throws {
        defaults = UserDefaults(suiteName: "PushModelTests")
        defaults.removePersistentDomain(forName: "PushModelTests")
    }

    private func model() -> PushModel {
        PushModel(account: account, notifier: notifier, defaults: defaults)
    }

    func testAsksOnceAndRegistersEachLaunch() async {
        await model().start()
        await model().start()

        XCTAssertEqual(notifier.calls, ["ask", "register", "blocked", "register", "blocked"])
    }

    func testSaysWhenNotificationsAreOff() async {
        let model = model()
        await model.start()
        XCTAssertFalse(model.off)

        notifier.off = true
        await model.check()
        XCTAssertTrue(model.off)
    }

    func testInTheForegroundNothingIsAnnouncedButWhatWasReadIsTakenAway() async {
        account.nextNotices = Notices(
            shown: [
                Notice(
                    conversation: "c1",
                    members: [person("a2", "Anna")],
                    seq: 4,
                    sender: person("a2", "Anna"),
                    kind: .text,
                    text: "hæ",
                    ts: FakeAccount.now
                )
            ],
            cleared: ["c2"]
        )

        await model().quiet()

        XCTAssertEqual(account.calls, ["notices"])
        XCTAssertEqual(notifier.calls, ["cancel [\"c2\"]"])
        // The core gave the notice to the app, so no push shows it again.
        XCTAssertEqual(try account.notices().shown, [])
    }

    func testAFailedReadTakesNothingAway() async {
        account.failNext = unreachable
        await model().quiet()
        XCTAssertEqual(notifier.calls, [])
    }

    func testATokenGoesWithTheSocketsNextSync() {
        let model = model()
        let live = FakeLive(account: account)
        model.live = live

        model.token(Data([0x0a, 0xff, 0x01]), sandbox: true)

        XCTAssertEqual(account.calls, ["setPushToken 0aff01 true", "sync"])
        XCTAssertEqual(live.performed, 1)
    }

    func testATokenBeforeTheSocketIsKeptForItsFirstSync() async throws {
        model().token(Data([0xab]), sandbox: false)

        let deadline = Date().addingTimeInterval(5)
        while account.calls.isEmpty && Date() < deadline { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertEqual(account.calls, ["setPushToken ab false"])
    }

    func testATapOpensItsConversationOnce() {
        let model = model()
        model.tapped("c1")
        XCTAssertEqual(model.opened, "c1")
        XCTAssertEqual(model.takeOpened(), "c1")
        XCTAssertNil(model.takeOpened())
    }

    func testOpeningAConversationTakesItsNotificationsAway() async {
        await model().dismiss("c1")
        XCTAssertEqual(notifier.calls, ["cancel [\"c1\"]"])
    }
}

/// The notification centre in memory.
final class FakeNotifier: Notifier, @unchecked Sendable {
    private let lock = NSLock()
    private var _calls: [String] = []
    private var _off = false

    var calls: [String] { lock.withLock { _calls } }

    var off: Bool {
        get { lock.withLock { _off } }
        set { lock.withLock { _off = newValue } }
    }

    private func record(_ call: String) {
        lock.withLock { _calls.append(call) }
    }

    func ask() async { record("ask") }

    func register() { record("register") }

    func blocked() async -> Bool {
        record("blocked")
        return off
    }

    func cancel(_ conversations: [String]) async { record("cancel \(conversations)") }
}
