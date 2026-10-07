import Foundation

/// Sleeps that end when the test says so: `pass` ends every sleep of one length.
final class FakeSleep: @unchecked Sendable {
    private typealias Sleeper = (id: Int, duration: Duration, wake: CheckedContinuation<Void, Error>)

    private let lock = NSLock()
    private var sleepers: [Sleeper] = []
    private var cancelled: Set<Int> = []
    private var next = 0

    /// The lengths of the sleeps not yet ended.
    var waiting: [Duration] { lock.withLock { sleepers.map(\.duration) } }

    func sleep(_ duration: Duration) async throws {
        let id = lock.withLock {
            next += 1
            return next
        }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (wake: CheckedContinuation<Void, Error>) in
                let gone = lock.withLock {
                    if cancelled.contains(id) { return true }
                    sleepers.append((id, duration, wake))
                    return false
                }
                if gone { wake.resume(throwing: CancellationError()) }
            }
        } onCancel: {
            let wake = lock.withLock { () -> CheckedContinuation<Void, Error>? in
                guard let index = sleepers.firstIndex(where: { $0.id == id }) else {
                    cancelled.insert(id)
                    return nil
                }
                return sleepers.remove(at: index).wake
            }
            wake?.resume(throwing: CancellationError())
        }
    }

    func pass(_ duration: Duration) {
        let woken = lock.withLock {
            let woken = sleepers.filter { $0.duration == duration }
            sleepers.removeAll { $0.duration == duration }
            return woken
        }
        for sleeper in woken { sleeper.wake.resume() }
    }
}
