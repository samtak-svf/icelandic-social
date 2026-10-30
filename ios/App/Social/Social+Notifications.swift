import SpjallCore

/// The notifications of the hosted social calls, as the core serves them (decisions 0103 to 0106).
extension CoreAccount {
    func notifications(before: String?, limit: UInt32) throws -> SocialNotificationPage {
        try core().notifications(before: before, limit: limit)
    }

    func readNotifications(upTo: UInt64) throws { try core().readNotifications(upTo: upTo) }

    func seenNotifications(upTo: UInt64) throws { try core().seenNotifications(upTo: upTo) }

    func readNotification(_ id: String, read: Bool) throws {
        try core().readNotification(notificationId: id, read: read)
    }

    func deleteNotification(_ id: String) throws { try core().deleteNotification(notificationId: id) }

    func notificationSettings() throws -> NotificationSettings { try core().notificationSettings() }

    func setNotificationSettings(kinds: [NotificationKindLevel]) throws {
        try core().setNotificationSettings(kinds: kinds)
    }

    func setCommunityNotificationLevel(_ community: String, level: NotificationLevel) throws {
        try core().setCommunityNotificationLevel(communityId: community, level: level)
    }
}

/// Where a notification opens: its post, or its community when it has no post or the post was moderated away;
/// nowhere when it has no community either (0114).
func noticeRoute(_ notification: SocialNotification) -> SocialRoute? {
    let target = noticeTarget(
        kind: notification.kind, postId: notification.postId, communityId: notification.communityId)
    if let post = target.post { return .post(post) }
    return target.community.map(SocialRoute.community)
}
