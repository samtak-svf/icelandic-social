import Foundation
import SpjallCore

@testable import Spjall

/// The socket as the models see it: calls run at once, in order, and their
/// events go to whoever listens. `emit` stands in for a frame.
@MainActor
final class FakeLive: Live {
    var connection = Connection.connecting
    private let account: Account
    private var listeners: [AsyncStream<Event>.Continuation] = []
    private(set) var sent: [String] = []
    private(set) var performed = 0

    init(account: Account) {
        self.account = account
    }

    func events() -> AsyncStream<Event> {
        let (stream, continuation) = AsyncStream.makeStream(of: Event.self)
        listeners.append(continuation)
        return stream
    }

    func perform(_ call: @escaping @Sendable (Account) throws -> Outcome) {
        performed += 1
        guard let outcome = try? call(account) else { return }
        sent += outcome.frames
        outcome.events.forEach(emit)
    }

    func send(_ frame: String) {
        sent.append(frame)
    }

    func emit(_ event: Event) {
        for listener in listeners { listener.yield(event) }
    }

    func finish() {
        for listener in listeners { listener.finish() }
    }
}
