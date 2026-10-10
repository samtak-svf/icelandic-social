import Foundation
@preconcurrency import UserNotifications

extension NoticeLabels {
    /// The brand's words, from the catalogue this target carries.
    static var brand: NoticeLabels {
        NoticeLabels(
            unnamed: String(localized: "person_unnamed"),
            alone: String(localized: "conversation_alone_title"),
            photo: String(localized: "photo"),
            file: String(localized: "file"),
            post: String(localized: "post_shared")
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

extension UNUserNotificationCenter {
    /// Takes away every delivered notification in these conversations' threads.
    func removeDelivered(conversations: [String]) async {
        guard !conversations.isEmpty else { return }
        let threads = Set(conversations)
        let ids = await deliveredNotifications()
            .filter { threads.contains($0.request.content.threadIdentifier) }
            .map(\.request.identifier)
        removeDeliveredNotifications(withIdentifiers: ids)
    }
}
