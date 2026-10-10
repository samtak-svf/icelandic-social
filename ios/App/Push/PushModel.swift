import Foundation
import Observation
import SpjallCore

/// The system's notifications as the app changes them: the notification
/// service posts them, and the app only asks, registers and takes away.
protocol Notifier: Sendable {
    /// Asks the person to allow notifications.
    func ask() async
    /// Asks the system for this device's push token, which arrives at `PushModel.token`.
    @MainActor func register()
    /// Whether the person has turned this app's notifications off.
    func blocked() async -> Bool
    /// Takes away the notifications of these conversations.
    func cancel(_ conversations: [String]) async
}

/// Push in the app (decision 0025). The notification service announces what a
/// push brought; the app hands the core the device's token, counts what
/// arrives while it is open as seen, so a later push never repeats it, and
/// takes away the notifications of what was read. A tap opens the conversation.
@MainActor @Observable
final class PushModel {
    /// The conversation a tapped notification opens, until the screens take it.
    private(set) var opened: String?
    /// The person turned notifications off; the conversation list and the settings say where to turn them on.
    private(set) var off = false

    @ObservationIgnored private let account: Account
    @ObservationIgnored private let notifier: Notifier
    @ObservationIgnored private let defaults: UserDefaults
    /// The socket, while the signed-in screens are up: a new token goes with its next sync.
    @ObservationIgnored weak var live: Live?

    private static let askedKey = "push.asked"

    init(account: Account, notifier: Notifier, defaults: UserDefaults = .standard) {
        self.account = account
        self.notifier = notifier
        self.defaults = defaults
    }

    /// After sign-in: asks once per install, then registers each launch.
    func start() async {
        if !defaults.bool(forKey: Self.askedKey) {
            defaults.set(true, forKey: Self.askedKey)
            await notifier.ask()
        }
        notifier.register()
        await check()
    }

    /// Reads whether notifications are off, as when the app comes back on screen.
    func check() async {
        off = await notifier.blocked()
    }

    /// The token the system gave; the core sends it only if the server lacks it.
    func token(_ token: Data, sandbox: Bool) {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        if let live {
            live.perform {
                try $0.setPushToken(hex, sandbox: sandbox)
                return try $0.sync()
            }
        } else {
            let account = account
            Task { try? await offMain { try account.setPushToken(hex, sandbox: sandbox) } }
        }
    }

    /// What arrived while the app was open was on screen: nothing is
    /// announced, and the notifications of what was read go.
    func quiet() async {
        let account = account
        guard let notices = try? await offMain({ try account.notices() }) else { return }
        await notifier.cancel(notices.cleared)
    }

    /// The conversation is on screen: its notifications go.
    func dismiss(_ conversation: String) async {
        await notifier.cancel([conversation])
    }

    /// A notification was tapped.
    func tapped(_ conversation: String) {
        guard !conversation.isEmpty else { return }
        opened = conversation
    }

    /// The conversation a tap asked for, once.
    func takeOpened() -> String? {
        defer { opened = nil }
        return opened
    }
}
