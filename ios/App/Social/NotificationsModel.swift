import Foundation
import Observation
import SpjallCore

/// The notifications tab (decision 0063): comments on and reactions to this account's posts, an approved
/// request to join, and a moderator's action on what it wrote, newest first. The tab bar shows how many are
/// unread; opening the tab marks read every one up to the newest.
@MainActor @Observable
final class NotificationsModel {
    private(set) var notifications: [SocialNotification] = []
    /// How many are unread, as the server counts them.
    private(set) var unread = 0
    /// The cursor of the next, older page, nil on the last.
    private(set) var next: String?
    private(set) var loaded = false
    private(set) var busy = false
    private(set) var problem: Problem?

    private let social: Social
    private var failed: (() async -> Void)?

    init(social: Social) {
        self.social = social
    }

    func load() async {
        await perform(again: { await self.load() }) { try await self.first() }
    }

    /// The newest page again, for the tab bar's count, when the app comes back to the front. Quiet: a failure
    /// leaves what is shown.
    func refresh() async {
        guard !busy else { return }
        try? await first()
    }

    /// The next, older page, if there is one.
    func more() async {
        guard let next else { return }
        let social = social
        await perform(again: { await self.more() }) {
            let page = try await offMain { try social.notifications(before: next, limit: Self.page) }
            let shown = Set(self.notifications.map(\.notificationId))
            self.notifications += page.notifications.filter { !shown.contains($0.notificationId) }
            self.next = page.next
        }
    }

    /// Marks read every notification up to the newest shown. Quiet: an unread count left over is no harm, and
    /// the next visit marks it again.
    func markRead() async {
        guard unread > 0, let newest = notifications.first?.createdAt else { return }
        let social = social
        do {
            try await offMain { try social.readNotifications(upTo: newest) }
        } catch {
            return
        }
        for index in notifications.indices where notifications[index].createdAt <= newest {
            notifications[index].read = true
        }
        // The newest shown is the newest there is, so nothing older is left unread.
        unread = 0
    }

    private func first() async throws {
        let social = social
        let page = try await offMain { try social.notifications(before: nil, limit: Self.page) }
        notifications = page.notifications
        unread = Int(page.unread)
        next = page.next
        loaded = true
    }

    /// A page of notifications.
    private nonisolated static let page: UInt32 = 30

    /// Tries the action that failed again.
    func retry() async {
        await failed?()
    }

    private func perform(again: @escaping () async -> Void, _ action: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        problem = nil
        do {
            try await action()
            failed = nil
        } catch {
            failed = again
            loaded = true
            problem = Problem(error)
        }
        busy = false
    }
}
