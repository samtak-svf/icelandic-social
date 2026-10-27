import Foundation
import SpjallCore
@preconcurrency import UserNotifications

extension NoticeLabels {
    /// The brand's words, from the catalogue this target carries.
    static var brand: NoticeLabels {
        NoticeLabels(
            unnamed: String(localized: "person_unnamed"),
            alone: String(localized: "conversation_alone_title"),
            photo: String(localized: "photo"),
            file: String(localized: "file"),
            post: String(localized: "post_shared"),
            location: String(localized: "location")
        )
    }
}

extension Announcement {
    /// The notification's content, in its conversation's thread, which a tap opens.
    func content(sound: UNNotificationSound? = .default) -> UNNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.threadIdentifier = conversation
        content.sound = sound
        return content
    }
}

/// The `userInfo` keys of a social notification: what a tap opens.
enum SocialTapKey {
    static let post = "post"
    static let community = "community"
}

extension SocialAnnouncement {
    /// The notification's content, in a thread of its own named by the notification's id (decision 0107).
    func content(sound: UNNotificationSound? = .default) -> UNNotificationContent {
        let content = UNMutableNotificationContent()
        content.body = sentence
        content.threadIdentifier = id
        content.sound = sound
        var info: [String: String] = [SocialTapKey.community: community]
        if let post { info[SocialTapKey.post] = post }
        content.userInfo = info
        return content
    }
}

/// The alerts a push becomes, the first taking the push's own. Chat wins: only when there is nothing to say about
/// a conversation do the social notices get their alerts (decision 0107). Empty when there is nothing new.
func pushContents(_ notices: Notices, labels: NoticeLabels, sound: UNNotificationSound?) -> [UNNotificationContent] {
    let chat = announcements(notices.shown, labels: labels)
    if !chat.isEmpty { return chat.map { $0.content(sound: sound) } }
    return socialAnnouncements(notices.social).map { $0.content(sound: sound) }
}

/// The threads to take off the lock screen: the conversations' and the social notifications' own (0025, 0107).
func clearedThreads(_ notices: Notices) -> [String] { notices.cleared + notices.socialCleared }

extension UNUserNotificationCenter {
    /// Takes away every delivered notification in these threads: a conversation's (decision 0025) or a social
    /// notification's own, named by its id (decision 0107).
    func removeDelivered(threads: [String]) async {
        guard !threads.isEmpty else { return }
        let threads = Set(threads)
        let ids = await deliveredNotifications()
            .filter { threads.contains($0.request.content.threadIdentifier) }
            .map(\.request.identifier)
        removeDeliveredNotifications(withIdentifiers: ids)
    }
}
