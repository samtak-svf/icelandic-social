import SwiftUI
@preconcurrency import UserNotifications

/// The system's side of push: the device token, and the notifications shown
/// or tapped while the app runs.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let push = PushModel(account: SpjallApp.account, notifier: SystemNotifier())

    /// Development builds get their token from APNs' sandbox.
    #if DEBUG
        private static let sandbox = true
    #else
        private static let sandbox = false
    #endif

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
        push.token(token, sandbox: Self.sandbox)
    }

    /// No token, as in a build without the push entitlement: the app works without push.
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {}

    /// While the app is open its screens show what arrived; the notification would repeat it.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        []
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let conversation = response.notification.request.content.threadIdentifier
        await MainActor.run { push.tapped(conversation) }
    }
}

/// The notification centre, as `PushModel` uses it.
struct SystemNotifier: Notifier {
    func ask() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
    }

    @MainActor func register() {
        UIApplication.shared.registerForRemoteNotifications()
    }

    func blocked() async -> Bool {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .denied
    }

    func cancel(_ conversations: [String]) async {
        await UNUserNotificationCenter.current().removeDelivered(conversations: conversations)
    }
}
