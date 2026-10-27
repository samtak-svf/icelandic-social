import Foundation
import Observation
import SpjallCore

/// The system's notifications as the app changes them: the notification
/// service posts them, and the app only asks, registers and takes away.
protocol Notifier: Sendable {
    /// Asks the person to allow notifications; only from the first launch's button (decision 0043).
    func ask() async
    /// Whether the person has not yet answered the system's prompt.
    func undetermined() async -> Bool
    /// Asks the system for this device's push token, which arrives at `PushModel.token`.
    @MainActor func register()
    /// Whether the person has turned this app's notifications off.
    func blocked() async -> Bool
    /// Takes away the notifications of these conversations.
    func cancel(_ conversations: [String]) async
}

/// What a tapped social notification opens.
struct SocialTap: Equatable, Sendable {
    let post: String?
    let community: String
}

/// Push in the app (decision 0025). The notification service announces what a
/// push brought; the app hands the core the device's token, counts what
/// arrives while it is open as seen, so a later push never repeats it, and
/// takes away the notifications of what was read. A tap opens the conversation.
@MainActor @Observable
final class PushModel {
    /// The conversation a tapped notification opens, until the screens take it.
    private(set) var opened: String?
    /// The post, or the community, a tapped social notification opens, until the screens take it (decision 0107).
    private(set) var openedSocial: SocialTap?
    /// The person turned notifications off; the conversation list and the settings say where to turn them on.
    private(set) var off = false

    @ObservationIgnored private let account: Account
    /// Also the first launch's, which asks for permission (decision 0043).
    @ObservationIgnored let notifier: Notifier
    /// The socket, while the signed-in screens are up: a new token goes with its next sync.
    @ObservationIgnored weak var live: Live?

    init(account: Account, notifier: Notifier) {
        self.account = account
        self.notifier = notifier
    }

    /// After sign-in, each launch: registers, and never asks; the first launch's priming step does (decision 0043).
    func start() async {
        notifier.register()
        await check()
    }

    /// Reads whether notifications are off, as when the app comes back on screen.
    func check() async {
        off = await notifier.blocked()
    }

    /// The token the system gave; the core sends it only if the server lacks it. Only then does it
    /// start a sync: the system gives the same token at each launch (0056).
    func token(_ token: Data, sandbox: Bool) {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        if let live {
            live.perform {
                guard try $0.setPushToken(hex, sandbox: sandbox) else { return Outcome(events: [], frames: []) }
                return try $0.sync()
            }
        } else {
            let account = account
            Task { _ = try? await offMain { try account.setPushToken(hex, sandbox: sandbox) } }
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

    /// A social notification was tapped: its post, or its community when it has none.
    func tappedSocial(post: String?, community: String) {
        openedSocial = SocialTap(post: post, community: community)
    }

    /// The social target a tap asked for, once.
    func takeOpenedSocial() -> SocialTap? {
        defer { openedSocial = nil }
        return openedSocial
    }

    /// The conversation a tap asked for, once.
    func takeOpened() -> String? {
        defer { opened = nil }
        return opened
    }
}
