// Phase 0 stub. In phase 1 this decrypts the MLS message named by the push,
// whose payload carries no content (decision 0002), and shows it.
@preconcurrency import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        contentHandler(request.content)
    }
}
