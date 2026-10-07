import Foundation
import SpjallCore
import XCTest

@testable import Spjall

@MainActor
final class SocketTests: XCTestCase {
    private let account = FakeAccount(signedIn: true)
    private let wire = FakeWire()
    private let waits = Waits()

    private func socket() -> Socket {
        let waits = waits
        return Socket(account: account, wire: wire, wait: { await waits.record($0) })
    }

    func testSyncsWhenOpenAndSendsTheFramesTheCoreMade() async {
        account.outcome = Outcome(events: [.timeline(conversation: "c1", changed: [1])], frames: ["ack"])
        let socket = socket()
        var events = socket.events().makeAsyncIterator()
        socket.start()
        let link = await wire.link(1)
        XCTAssertEqual(link.token, "device-token")
        XCTAssertEqual(socket.connection, .connecting)

        link.signal(.opened)
        let event = await events.next()
        XCTAssertEqual(event, .timeline(conversation: "c1", changed: [1]))
        XCTAssertEqual(socket.connection, .online)
        XCTAssertEqual(link.sent, ["ack"])
        XCTAssertEqual(account.calls.suffix(1), ["sync"])
    }

    func testPassesEachFrameToTheCore() async {
        let socket = socket()
        var events = socket.events().makeAsyncIterator()
        socket.start()
        let link = await wire.link(1)
        link.signal(.opened)
        account.outcome = Outcome(events: [.typing(conversation: "c1", active: true)], frames: [])
        link.signal(.frame("{\"type\":\"typing\"}"))
        _ = await events.next()
        let event = await events.next()
        XCTAssertEqual(event, .typing(conversation: "c1", active: true))
        XCTAssertTrue(account.calls.contains("onFrame {\"type\":\"typing\"}"))
    }

    func testReconnectsAfterABackoffThatGrowsAndResetsOnceOpen() async {
        let socket = socket()
        socket.start()
        await wire.link(1).signal(.closed)
        await wire.link(2).signal(.closed)
        let third = await wire.link(3)
        XCTAssertEqual(socket.connection, .connecting)
        let waited = waits.all
        XCTAssertEqual(waited.count, 2)
        XCTAssertTrue((.milliseconds(500) ... .milliseconds(1_000)).contains(waited[0]), "\(waited)")
        XCTAssertTrue((.milliseconds(1_000) ... .milliseconds(2_000)).contains(waited[1]), "\(waited)")

        third.signal(.opened)
        third.signal(.closed)
        _ = await wire.link(4)
        XCTAssertTrue((.milliseconds(500) ... .milliseconds(1_000)).contains(waits.all[2]), "\(waits.all)")
        socket.stop()
    }

    func testShowsOfflineWhileWaitingToReconnect() async {
        waits.hold = true
        let socket = socket()
        socket.start()
        await wire.link(1).signal(.closed)
        await waits.started(1)
        XCTAssertEqual(socket.connection, .offline)
        socket.stop()
        XCTAssertEqual(socket.connection, .connecting)
    }

    func testOpensNothingWhenSignedOut() async {
        account.token = nil
        let socket = socket()
        socket.start()
        await eventually { self.account.calls.contains("deviceToken") }
        account.token = "device-token"
        socket.start()
        _ = await wire.link(1)
        XCTAssertEqual(wire.opened.count, 1)
    }

    func testStopClosesTheSocket() async {
        let socket = socket()
        socket.start()
        let link = await wire.link(1)
        link.signal(.opened)
        await eventually { socket.connection == .online }
        socket.stop()
        await eventually { link.closed }
        XCTAssertEqual(socket.connection, .connecting)
    }

    func testAFailedCallIsDroppedAndTheNextOneDelivered() async {
        let socket = socket()
        var events = socket.events().makeAsyncIterator()
        account.failNext = unreachable
        socket.sync()
        account.outcome = Outcome(events: [.joined(conversation: "c2")], frames: [])
        socket.sync()
        let event = await events.next()
        XCTAssertEqual(event, .joined(conversation: "c2"))
    }
}

/// The socket's waits between reconnects, returning at once unless held.
final class Waits: @unchecked Sendable {
    private let lock = NSLock()
    private var durations: [Duration] = []
    var hold = false

    var all: [Duration] { lock.withLock { durations } }

    func record(_ duration: Duration) async {
        lock.withLock { durations.append(duration) }
        if hold { try? await Task.sleep(for: .seconds(60)) }
    }

    func started(_ count: Int) async {
        while all.count < count { await Task.yield() }
    }
}

/// Waits, a while at most, for something another task does.
@MainActor
func eventually(_ condition: @MainActor () -> Bool, file: StaticString = #filePath, line: UInt = #line) async {
    for _ in 0..<2_000 {
        if condition() { return }
        try? await Task.sleep(for: .milliseconds(1))
    }
    XCTFail("never happened", file: file, line: line)
}
