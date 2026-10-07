import Foundation
import SpjallCore

/// What the screens ask of the core (decision 0019). Every call blocks on the
/// network, so the models make them off the main actor.
protocol Account: Sendable {
    func signedIn() throws -> Bool
    /// Kenni's authorize URL, for the browser.
    func beginSignIn() throws -> String
    func completeSignIn(callback: String, inviteToken: String?) throws
    func stockKeyPackages() throws
    /// Who sent the invite; nil when the operator did or the inviter has no name.
    func resolveInvite(token: String) throws -> Inviter?
    func me() throws -> Me
    /// The link this device made last, if it still has one.
    func inviteLink() throws -> String?
    /// A new link, which ends the one before.
    func rotateInvite() throws -> String
    func revokeDevice(deviceId: String) throws
    func deleteAccount() throws
    /// The token the socket authenticates with; nil when signed out.
    func deviceToken() throws -> String?
    /// Sends what is queued and reads what is new (decision 0022).
    func sync() throws -> Outcome
    /// A frame the socket received.
    func onFrame(_ frame: String) throws -> Outcome
    /// The list, newest first, as the core orders it.
    func conversations() throws -> [Conversation]
    /// The people met through a shared conversation.
    func people() throws -> [Person]
    /// A new conversation with these accounts; its id.
    func createConversation(with accounts: [String]) throws -> String
    /// The 1:1 with whoever made this invite, made if there is none; its id.
    func openInvite(token: String) throws -> String
}

/// The core's client, opened on first use so a launch never waits for the
/// store before drawing.
final class CoreAccount: Account, @unchecked Sendable {
    /// How many KeyPackages the server should hold for this device.
    static let keyPackages: UInt32 = 10

    private let open: @Sendable () throws -> CoreClient
    private let lock = NSLock()
    private var client: CoreClient?

    init(open: @escaping @Sendable () throws -> CoreClient) {
        self.open = open
    }

    private func core() throws -> CoreClient {
        try lock.withLock {
            if let client { return client }
            let opened = try open()
            client = opened
            return opened
        }
    }

    func signedIn() throws -> Bool { try core().signedIn() != nil }

    func beginSignIn() throws -> String { try core().beginSignIn() }

    func completeSignIn(callback: String, inviteToken: String?) throws {
        _ = try core().completeSignIn(callback: callback, inviteToken: inviteToken, platform: .ios)
    }

    func stockKeyPackages() throws { _ = try core().stockKeyPackages(target: Self.keyPackages) }

    func resolveInvite(token: String) throws -> Inviter? { try core().resolveInvite(token: token) }

    func me() throws -> Me { try core().me() }

    func inviteLink() throws -> String? { try core().inviteLink() }

    func rotateInvite() throws -> String { try core().rotateInvite() }

    func revokeDevice(deviceId: String) throws { try core().revokeDevice(deviceId: deviceId) }

    func deleteAccount() throws { try core().deleteAccount() }

    func deviceToken() throws -> String? { try core().deviceToken() }

    func sync() throws -> Outcome { try core().sync() }

    func onFrame(_ frame: String) throws -> Outcome { try core().onFrame(frame: frame) }

    func conversations() throws -> [Conversation] { try core().conversations() }

    func people() throws -> [Person] { try core().people() }

    func createConversation(with accounts: [String]) throws -> String {
        try core().createConversation(with: accounts)
    }

    func openInvite(token: String) throws -> String { try core().openInvite(token: token) }
}

/// Runs a blocking core call off the main actor.
func offMain<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
    try await Task.detached(priority: .userInitiated) { try work() }.value
}
