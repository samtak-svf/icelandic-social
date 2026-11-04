import Foundation

/// Tells the bell to ask for its count again (#570). A call that ends one of the account's own notices, such as
/// answering an invitation or a friend request, leaves the count one too high until the next time it is asked for, so
/// `CoreAccount` announces each such call once it has succeeded and no screen has to remember to.
final class NoticeChanges: Sendable {
    private let listeners = NSLock()
    nonisolated(unsafe) private var continuations: [UUID: AsyncStream<Void>.Continuation] = [:]

    /// A stream of announcements from now on; announcements made while nobody reads are folded into one.
    func changes() -> AsyncStream<Void> {
        let (stream, continuation) = AsyncStream.makeStream(of: Void.self, bufferingPolicy: .bufferingNewest(1))
        let id = UUID()
        listeners.withLock { continuations[id] = continuation }
        continuation.onTermination = { [weak self] _ in
            self?.listeners.withLock { _ = self?.continuations.removeValue(forKey: id) }
        }
        return stream
    }

    func announce() {
        let all = listeners.withLock { Array(continuations.values) }
        for continuation in all { continuation.yield() }
    }
}

/// What the bell listens to.
protocol Noticing: Sendable {
    var noticeChanges: NoticeChanges { get }
}

extension CoreAccount: Noticing {
    /// `result` of a call that succeeded and ended a notice of the caller's, after announcing it.
    func ended<T>(_ result: T) -> T {
        noticeChanges.announce()
        return result
    }
}
