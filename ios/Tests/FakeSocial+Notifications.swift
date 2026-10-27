import SpjallCore

@testable import Spjall

/// The notification calls of `FakeSocial`: the list, what was seen and read, and the levels.
extension FakeSocial {
    func notifications(before: String?, limit: UInt32) throws -> SocialNotificationPage {
        try call("notifications \(before ?? "-")")
        let all = notifications
        let (found, next) = page(all, after: before)
        return SocialNotificationPage(
            notifications: found, unread: UInt64(all.filter { !$0.read }.count),
            unseen: UInt64(all.filter { $0.createdAt > (seenAt ?? 0) }.count), seenAt: seenAt, next: next)
    }

    /// When the list was last looked at, as the server holds it.
    var seenAt: UInt64? {
        get { lock.withLock { _seenAt } }
        set { lock.withLock { _seenAt = newValue } }
    }

    /// The levels as the server holds them.
    var settings: NotificationSettings {
        get { lock.withLock { _settings } }
        set { lock.withLock { _settings = newValue } }
    }

    func seenNotifications(upTo: UInt64) throws {
        try call("seenNotifications \(upTo)")
        seenAt = max(seenAt ?? 0, upTo)
    }

    func readNotification(_ id: String, read: Bool) throws {
        try call("readNotification \(id) \(read)")
        notifications = notifications.map { notice in
            var notice = notice
            if notice.notificationId == id { notice.read = read }
            return notice
        }
    }

    func deleteNotification(_ id: String) throws {
        try call("deleteNotification \(id)")
        notifications.removeAll { $0.notificationId == id }
    }

    func notificationSettings() throws -> NotificationSettings {
        try call("notificationSettings")
        return settings
    }

    func setNotificationSettings(kinds: [NotificationKindLevel]) throws {
        try call("setNotificationSettings " + kinds.map { "\($0.kind):\($0.level)" }.joined(separator: ","))
        var current = settings
        for change in kinds {
            current.kinds.removeAll { $0.kind == change.kind }
            current.kinds.append(change)
        }
        settings = current
    }

    func setCommunityNotificationLevel(_ community: String, level: NotificationLevel) throws {
        try call("setCommunityNotificationLevel \(community) \(level)")
        var current = settings
        current.communities.removeAll { $0.communityId == community }
        current.communities.append(CommunityNotificationLevel(communityId: community, level: level))
        settings = current
    }

    func readNotifications(upTo: UInt64) throws {
        try call("readNotifications \(upTo)")
        notifications = notifications.map { notice in
            var notice = notice
            if notice.createdAt <= upTo { notice.read = true }
            return notice
        }
    }
}
