import Foundation

@testable import Spjall

/// The WebSocket in memory: each `open` is a socket the test drives through
/// `signal`, and `sent` records what went out on it.
final class FakeWire: Wire, @unchecked Sendable {
    private let lock = NSLock()
    private var links: [FakeLink] = []
    private var waiters: [(count: Int, continuation: CheckedContinuation<Void, Never>)] = []

    var opened: [FakeLink] { lock.withLock { links } }

    func open(token: String, on: @escaping @Sendable (Signal) -> Void) -> Link {
        let link = FakeLink(token: token, on: on)
        let ready = lock.withLock {
            links.append(link)
            let count = links.count
            let ready = waiters.filter { $0.count <= count }
            waiters.removeAll { $0.count <= count }
            return ready
        }
        ready.forEach { $0.continuation.resume() }
        return link
    }

    /// Waits until `count` sockets have been opened, and returns the last.
    func link(_ count: Int) async -> FakeLink {
        await withCheckedContinuation { continuation in
            let now = lock.withLock {
                if links.count >= count { return true }
                waiters.append((count, continuation))
                return false
            }
            if now { continuation.resume() }
        }
        return lock.withLock { links[count - 1] }
    }
}

final class FakeLink: Link, @unchecked Sendable {
    let token: String
    private let on: @Sendable (Signal) -> Void
    private let lock = NSLock()
    private var _sent: [String] = []
    private var _closed = false

    init(token: String, on: @escaping @Sendable (Signal) -> Void) {
        self.token = token
        self.on = on
    }

    var sent: [String] { lock.withLock { _sent } }
    var closed: Bool { lock.withLock { _closed } }

    func signal(_ signal: Signal) { on(signal) }

    func send(_ frame: String) { lock.withLock { _sent.append(frame) } }

    func close() { lock.withLock { _closed = true } }
}
