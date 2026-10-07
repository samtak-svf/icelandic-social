import Foundation
import Observation
import SpjallCore

/// Opens the WebSocket: URLSession's in the app, a fake in tests.
protocol Wire: Sendable {
    /// Opens `/v1/ws` with the device `token`. `on` hears what happens on it,
    /// from any thread, ending with `.closed`.
    func open(token: String, on: @escaping @Sendable (Signal) -> Void) -> Link
}

/// One open socket.
protocol Link: Sendable {
    func send(_ frame: String)
    func close()
}

enum Signal: Sendable, Equatable {
    case opened
    case frame(String)
    /// Closed by either side, or failed, a missed pong included.
    case closed
}

/// What the list's connection line shows.
enum Connection: Sendable {
    case connecting, online, offline
}

/// What the screens read from the socket.
@MainActor
protocol Live: AnyObject {
    var connection: Connection { get }
    /// Every event the core returns from here on, from the socket's frames and from each sync.
    func events() -> AsyncStream<Event>
    /// Runs a core call that returns an `Outcome`, in turn with the socket's own, and delivers it.
    func perform(_ call: @escaping @Sendable (Account) throws -> Outcome)
    /// As `perform`, but waits for the call, and throws what it threw.
    func performAndWait(_ call: @escaping @Sendable (Account) throws -> Outcome) async throws
    /// Sends a frame the core made, such as `typing`; dropped while the socket is closed.
    func send(_ frame: String)
}

extension Live {
    /// Syncs now, as after a change the server has to hear of.
    func sync() { perform { try $0.sync() } }
}

/// The socket (decision 0022), open while the app is in the foreground:
/// `start` and `stop` follow the scene phase. It reconnects with jittered
/// backoff, calls `sync()` on connect, passes each frame to `on_frame`, and
/// sends the frames each `Outcome` returns. The core does the rest.
@MainActor @Observable
final class Socket: Live {
    private(set) var connection = Connection.connecting

    @ObservationIgnored private let account: Account
    @ObservationIgnored private let wire: Wire
    @ObservationIgnored private let wait: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private var running: Task<Void, Never>?
    @ObservationIgnored private var link: Link?
    @ObservationIgnored private var listeners: [UUID: AsyncStream<Event>.Continuation] = [:]
    // One core call's events reach the screens before the next call's.
    @ObservationIgnored private var tail: Task<Void, Never>?

    init(
        account: Account,
        wire: Wire,
        wait: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.account = account
        self.wire = wire
        self.wait = wait
    }

    /// Opens the socket and keeps it open until `stop`. Does nothing while it runs, or when signed out.
    func start() {
        guard running == nil else { return }
        running = Task { await run() }
    }

    func stop() {
        running?.cancel()
        running = nil
        connection = .connecting
    }

    func events() -> AsyncStream<Event> {
        let (stream, continuation) = AsyncStream.makeStream(of: Event.self, bufferingPolicy: .bufferingNewest(64))
        let id = UUID()
        listeners[id] = continuation
        continuation.onTermination = { _ in
            Task { @MainActor [weak self] in self?.listeners[id] = nil }
        }
        return stream
    }

    func perform(_ call: @escaping @Sendable (Account) throws -> Outcome) {
        let account = account
        Task { await deliver { try call(account) } }
    }

    func performAndWait(_ call: @escaping @Sendable (Account) throws -> Outcome) async throws {
        let account = account
        let previous = tail
        let next = Task {
            await previous?.value
            emit(try await offMain { try call(account) })
        }
        tail = Task { _ = try? await next.value }
        try await next.value
    }

    func send(_ frame: String) {
        link?.send(frame)
    }

    private func run() async {
        var failures = 0
        let account = account
        while !Task.isCancelled {
            let token = (try? await offMain { try account.deviceToken() }) ?? nil
            guard let token, !Task.isCancelled else { break }
            connection = .connecting
            if await session(token: token) { failures = 0 }
            guard !Task.isCancelled else { break }
            connection = .offline
            try? await wait(backoff(failures: failures))
            failures += 1
        }
        // Signed out: a later `start` begins again. A cancelled run was replaced by `stop`.
        if !Task.isCancelled { running = nil }
    }

    /// One socket, until it closes or the task is cancelled. True when it opened.
    private func session(token: String) async -> Bool {
        let (signals, continuation) = AsyncStream.makeStream(of: Signal.self)
        let open = wire.open(token: token) { signal in
            continuation.yield(signal)
            if signal == .closed { continuation.finish() }
        }
        defer {
            link = nil
            open.close()
        }
        let account = account
        var opened = false
        for await signal in signals {
            switch signal {
            case .opened:
                opened = true
                link = open
                connection = .online
                await deliver { try account.sync() }
            case .frame(let text):
                await deliver { try account.onFrame(text) }
            case .closed:
                return opened
            }
        }
        return opened
    }

    /// Runs one core call off the main actor, sends its frames and hands its events on.
    private func deliver(_ call: @escaping @Sendable () throws -> Outcome) async {
        let previous = tail
        let next = Task {
            await previous?.value
            // A failed call changed nothing; the next sync or frame tries again.
            guard let outcome = try? await offMain(call) else { return }
            emit(outcome)
        }
        tail = next
        await next.value
    }

    private func emit(_ outcome: Outcome) {
        for frame in outcome.frames { link?.send(frame) }
        for event in outcome.events {
            for listener in listeners.values { listener.yield(event) }
        }
    }

    /// Doubling from 1 s to 30 s, each wait drawn from its upper half so that devices spread out.
    private func backoff(failures: Int) -> Duration {
        let ceiling = min(30_000, 1_000 << min(failures, 5))
        return .milliseconds(ceiling / 2 + Int.random(in: 0...ceiling / 2))
    }
}
