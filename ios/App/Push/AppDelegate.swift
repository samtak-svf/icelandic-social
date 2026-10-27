import SwiftUI
@preconcurrency import UserNotifications

/// The system's side of push: the device token, and the notifications shown
/// or tapped while the app runs.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    let push = PushModel(account: SpjallApp.account, notifier: SystemNotifier())
    /// The background time `didEnterBackground` asked for while the store closes.
    private var closingTask = UIBackgroundTaskIdentifier.invalid

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
        let center = NotificationCenter.default
        let background = UIApplication.didEnterBackgroundNotification
        center.addObserver(self, selector: #selector(didEnterBackground), name: background, object: nil)
        // Before the scene turns active, so the socket's first call finds the store open.
        let foreground = UIApplication.willEnterForegroundNotification
        center.addObserver(self, selector: #selector(willEnterForeground), name: foreground, object: nil)
        return true
    }

    /// Closes the store before the app is suspended (see `CoreAccount`), with
    /// background time for the calls still running to return.
    @objc private func didEnterBackground() {
        endClosing()
        closingTask = UIApplication.shared.beginBackgroundTask { [weak self] in self?.endClosing() }
        let task = closingTask
        let closing = SpjallApp.account.suspend()
        Task {
            var waited = 0
            while !closing.closed && waited < 250 {
                try? await Task.sleep(for: .milliseconds(100))
                waited += 1
            }
            // A later trip to the background asked for time of its own.
            if closingTask == task { endClosing() }
        }
    }

    @objc private func willEnterForeground() {
        endClosing()
        SpjallApp.account.resume()
    }

    private func endClosing() {
        guard closingTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(closingTask)
        closingTask = .invalid
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

    func undetermined() async -> Bool {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .notDetermined
    }

    @MainActor func register() {
        UIApplication.shared.registerForRemoteNotifications()
    }

    func blocked() async -> Bool {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .denied
    }

    func cancel(_ conversations: [String]) async {
        await UNUserNotificationCenter.current().removeDelivered(threads: conversations)
    }
}
