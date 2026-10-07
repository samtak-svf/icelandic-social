import Foundation
import SpjallCore
@preconcurrency import UserNotifications

/// Rewrites the push (decision 0025). It names no conversation, so this syncs
/// the shared store, asks the core what to announce, and shows each
/// conversation's new items in its own thread. The first conversation takes
/// the push's alert; any others get alerts of their own. What was read since
/// leaves the notification centre.
///
/// Until it finishes, or if it cannot, the push's own text stays: the
/// fallback "new messages" alert the Worker sent.
final class NotificationService: UNNotificationServiceExtension, @unchecked Sendable {
    private let lock = NSLock()
    private var handler: ((UNNotificationContent) -> Void)?
    private var fallback: UNNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        lock.withLock {
            handler = contentHandler
            fallback = request.content
        }
        let sound = request.content.sound
        Task.detached { [self] in
            deliver(await Self.rewrite(sound: sound))
        }
    }

    /// Out of time: the fallback stays.
    override func serviceExtensionTimeWillExpire() {
        deliver(nil)
    }

    /// Hands the system its content once; the fallback when there is none.
    private func deliver(_ content: UNNotificationContent?) {
        lock.lock()
        let pending = handler
        let original = fallback
        handler = nil
        lock.unlock()
        guard let pending, let original else { return }
        pending(content ?? original)
    }

    /// The alert this push becomes; nil when the store or the server could not be read.
    private static func rewrite(sound: UNNotificationSound?) async -> UNNotificationContent? {
        let notices: Notices
        do {
            let core = try CoreStore.open()
            _ = try core.sync()
            notices = try core.notices()
        } catch {
            return nil
        }
        let center = UNUserNotificationCenter.current()
        await center.removeDelivered(conversations: notices.cleared)
        let all = announcements(notices.shown, labels: .brand)
        // Nothing new, as when the app was opened meanwhile: iOS does not show empty content.
        guard let first = all.first else { return UNNotificationContent() }
        for other in all.dropFirst() {
            let request = UNNotificationRequest(
                identifier: UUID().uuidString,
                content: other.content(sound: sound),
                trigger: nil
            )
            try? await center.add(request)
        }
        return first.content(sound: sound)
    }
}
