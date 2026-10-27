import Foundation
import Observation
import SpjallCore

/// The notifications (decisions 0063, 0103, 0104, 0109): comments, replies and reactions to this account's posts and
/// comments, an approved request to join, and a moderator's action on what it wrote, one row per thing, newest
/// first. The bell shows how many are unseen: opening the list marks them seen, and only opening a row (or
/// "mark all read") reads it. Rows made since the last look are listed apart, as new.
@MainActor @Observable
final class NotificationsModel {
    private(set) var notifications: [SocialNotification] = []
    /// How many are unread, as the server counts them.
    private(set) var unread = 0
    /// How many have not been seen, which the bell shows (0104, 0109).
    private(set) var unseen = 0
    /// When the list was last looked at, as it was before this visit: rows made after it are new. Kept for the
    /// whole visit, so the rows do not slide into "earlier" the moment they are seen.
    private(set) var seenAt: UInt64?
    /// The cursor of the next, older page, nil on the last.
    private(set) var next: String?
    private(set) var loaded = false
    private(set) var busy = false
    private(set) var problem: Problem?

    private let social: Social
    private let cancel: @Sendable ([String]) async -> Void
    private var failed: (() async -> Void)?
    /// This visit has marked the list seen, so a page loaded after keeps the boundary from before.
    private var visiting = false

    /// `cancel` takes the delivered notifications with these ids off the lock screen (0107).
    init(social: Social, cancel: @escaping @Sendable ([String]) async -> Void = { _ in }) {
        self.social = social
        self.cancel = cancel
    }

    /// Rows made since the list was last looked at, or all of them when it never was.
    var fresh: [SocialNotification] { notifications.filter { notice in seenAt.map { $0 < notice.createdAt } ?? true } }

    /// The others.
    var earlier: [SocialNotification] {
        notifications.filter { notice in seenAt.map { $0 >= notice.createdAt } ?? false }
    }

    /// The tab is opened: the newest page, then everything on it marked seen.
    func appear() async {
        visiting = false
        await load()
        await markSeen()
    }

    func load() async {
        await perform(again: { await self.load() }) { try await self.first() }
    }

    /// The newest page again, for the bell's count, when the app comes back to the front. Quiet: a failure
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

    /// Marks the list seen up to the newest shown, which clears the bell's count and reads no row. Quiet: a failure
    /// leaves the count, and the next visit marks it again.
    func markSeen() async {
        guard let newest = notifications.first?.createdAt else { return }
        visiting = true
        guard unseen > 0 else { return }
        let social = social
        do {
            try await offMain { try social.seenNotifications(upTo: newest) }
        } catch {
            return
        }
        unseen = 0
    }

    /// Marks read every notification up to the newest shown. Quiet: an unread count left over is no harm.
    func markAllRead() async {
        guard unread > 0, let newest = notifications.first?.createdAt else { return }
        let social = social
        let ids = notifications.filter { !$0.read }.map(\.notificationId)
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
        await cancel(ids)
    }

    /// A row is opened: it is read, and its delivered notification goes. Opening goes on whatever the answer.
    func open(_ notification: SocialNotification) async {
        guard !notification.read else { return }
        await setRead(notification, true)
    }

    /// Marks one row read, or unread again, in place.
    func setRead(_ notification: SocialNotification, _ read: Bool) async {
        guard let index = notifications.firstIndex(where: { $0.notificationId == notification.notificationId }),
            notifications[index].read != read
        else { return }
        let social = social
        let id = notification.notificationId
        guard await quiet({ try social.readNotification(id, read: read) }) else { return }
        notifications[index].read = read
        unread = max(0, unread + (read ? -1 : 1))
        if read { await cancel([id]) }
    }

    /// Takes one row out of the list.
    func remove(_ notification: SocialNotification) async {
        let social = social
        let id = notification.notificationId
        guard await quiet({ try social.deleteNotification(id) }) else { return }
        if let index = notifications.firstIndex(where: { $0.notificationId == id }) {
            if !notifications[index].read { unread = max(0, unread - 1) }
            if notifications[index].createdAt > (seenAt ?? 0), unseen > 0 { unseen -= 1 }
            notifications.remove(at: index)
        }
        await cancel([id])
    }

    /// This kind of notification from now on in the app only, not on the phone.
    func inAppOnly(_ notification: SocialNotification) async {
        let social = social
        let change = NotificationKindLevel(kind: notification.kind, level: .inApp)
        _ = await quiet({ try social.setNotificationSettings(kinds: [change]) })
    }

    /// This notification's community off.
    func communityOff(_ notification: SocialNotification) async {
        let social = social
        let community = notification.communityId
        _ = await quiet({ try social.setCommunityNotificationLevel(community, level: .off) })
    }

    /// Whether the menu may offer to quiet this kind and community: a moderator's action is never lower than in
    /// the app (0106).
    func canQuiet(_ notification: SocialNotification) -> Bool { notification.kind != .moderated }

    /// Runs a call off the main actor and reports a failure as the problem; true when it worked.
    private func quiet(_ call: @escaping @Sendable () throws -> Void) async -> Bool {
        do {
            try await offMain(call)
            return true
        } catch {
            problem = Problem(error)
            return false
        }
    }

    private func first() async throws {
        let social = social
        let page = try await offMain { try social.notifications(before: nil, limit: Self.page) }
        notifications = page.notifications
        unread = Int(page.unread)
        unseen = Int(page.unseen)
        if !visiting { seenAt = page.seenAt }
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
