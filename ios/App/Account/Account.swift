import Foundation
import SpjallCore

/// What the screens ask of the core (decision 0019). Every call blocks on the
/// network, so the models make them off the main actor.
protocol Account: Sendable {
    func signedIn() throws -> Bool
    /// The provider's authorize URL, for the browser (decision 0033).
    func beginSignIn(provider: SignInProvider) throws -> String
    func completeSignIn(callback: String, inviteToken: String?) throws
    /// The authorize URL that links the provider to the signed-in account.
    func beginLink(provider: SignInProvider) throws -> String
    /// True when Kenni joined this device to the older account holding the
    /// kennitala (decision 0035).
    func completeLink(callback: String) throws -> Bool
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
    /// The conversations with someone whose name, or a word in it, starts with `query` (decision 0038),
    /// compared without case or the Icelandic letters; read on this device alone.
    func searchConversations(_ query: String) throws -> [Conversation]
    /// The list search (decision 0038): what `searchConversations` finds, then up to `limit` people from the
    /// directory, leaving out anyone whose 1:1 is among them, so no one shows twice.
    func searchList(_ query: String, limit: UInt32) throws -> ListSearch
    /// The people met through a shared conversation.
    func people() throws -> [Person]
    /// Everyone else signed in, verified first, a page after the cursor `after`, found by name (decision 0036).
    func directory(query: String?, after: String?, limit: UInt32) throws -> PersonPage
    /// A new conversation with these accounts; its id.
    func createConversation(with accounts: [String]) throws -> String
    /// The 1:1 with whoever made this invite, made if there is none; its id.
    func openInvite(token: String) throws -> String
    /// The conversation's items, oldest first, up to `limit` before the item `before`; the unsent ones last.
    func timeline(_ conversation: String, before: UInt64?, limit: UInt32) throws -> [Item]
    /// Queues a body to send; the next sync sends it.
    func send(_ conversation: String, body: Body) throws -> String
    /// Queues the failed items to send again.
    func retry(_ conversation: String) throws -> Outcome
    /// Everything up to `seq` was on screen; a receipt goes with the next sync when read markers are on.
    func markRead(_ conversation: String, seq: UInt64) throws
    /// The typing frame to send, or nil when typing is off or one went out less than 3 s ago.
    func typing(_ conversation: String, active: Bool) throws -> String?
    /// Deletes what is due to disappear.
    func expire() throws -> Outcome
    /// Seals and uploads the file at `path`, then sends it (decision 0023); the core keeps its own copy.
    func sendMedia(_ conversation: String, path: String, mime: String, caption: String?, name: String?) throws -> String
    /// The path of the photo or file at `seq`, downloaded and checked the first time.
    func media(_ conversation: String, seq: UInt64) throws -> String
    /// Copies the message at `seq` of `from` into `to` as a new message there, marked forwarded (decision 0041).
    /// Refused under a timer, for a deleted message and for a card.
    func forward(_ from: String, seq: UInt64, to: String) throws -> String
    /// Blocks `account` (decision 0024): it can no longer reach this one, and the 1:1 with it ends.
    func block(_ account: String) throws -> Outcome
    func unblock(_ account: String) throws
    /// The accounts this one blocked, newest first.
    func blocked() throws -> [Person]
    /// Mutes `conversation` for `duration` (decision 0042): no push for it from the server, no notice from the
    /// core, on every device of the account. The mute as the server set it.
    func mute(_ conversation: String, for duration: MuteFor) throws -> Mute
    /// Ends a mute; a conversation not muted stays so.
    func unmute(_ conversation: String) throws
    func settings() throws -> Settings
    func setSettings(_ settings: Settings) throws
    /// Keeps this device's push token; the next sync sends it if the server lacks it (decision 0025).
    func setPushToken(_ token: String, sandbox: Bool) throws
    /// What to announce since the last call, and the conversations read since; each notice is given once.
    func notices() throws -> Notices
    /// The 1:1 with `account`, made if there is none, without an invite; its id.
    func openDirect(_ account: String) throws -> String
    /// Sets this account's photo from the image at `path` (decision 0039); its new version.
    func setPhoto(path: String) throws -> String
    /// Removes this account's photo, for everyone.
    func removePhoto() throws
    /// The core's file for `account`'s photo at `version`; nil when it has none or a block stands between.
    func photo(account: String, version: String) throws -> String?
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

    func beginSignIn(provider: SignInProvider) throws -> String { try core().beginSignIn(provider: provider) }

    func completeSignIn(callback: String, inviteToken: String?) throws {
        _ = try core().completeSignIn(callback: callback, inviteToken: inviteToken, platform: .ios)
    }

    func beginLink(provider: SignInProvider) throws -> String { try core().beginLink(provider: provider) }

    func completeLink(callback: String) throws -> Bool { try core().completeLink(callback: callback) }

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

    func searchConversations(_ query: String) throws -> [Conversation] {
        try core().searchConversations(query: query)
    }

    func searchList(_ query: String, limit: UInt32) throws -> ListSearch {
        try core().searchList(query: query, limit: limit)
    }

    func people() throws -> [Person] { try core().people() }

    func directory(query: String?, after: String?, limit: UInt32) throws -> PersonPage {
        try core().directory(query: query, after: after, limit: limit)
    }

    func createConversation(with accounts: [String]) throws -> String {
        try core().createConversation(with: accounts)
    }

    func openInvite(token: String) throws -> String { try core().openInvite(token: token) }

    func timeline(_ conversation: String, before: UInt64?, limit: UInt32) throws -> [Item] {
        try core().timeline(conversation: conversation, before: before, limit: limit)
    }

    func send(_ conversation: String, body: Body) throws -> String {
        try core().send(conversation: conversation, body: body)
    }

    func retry(_ conversation: String) throws -> Outcome { try core().retry(conversation: conversation) }

    func markRead(_ conversation: String, seq: UInt64) throws {
        try core().markRead(conversation: conversation, seq: seq)
    }

    func typing(_ conversation: String, active: Bool) throws -> String? {
        try core().typing(conversation: conversation, active: active)
    }

    func expire() throws -> Outcome { try core().expire() }

    func sendMedia(_ conversation: String, path: String, mime: String, caption: String?, name: String?) throws -> String
    {
        try core().sendMedia(conversation: conversation, path: path, mime: mime, caption: caption, name: name)
    }

    func media(_ conversation: String, seq: UInt64) throws -> String {
        try core().media(conversation: conversation, seq: seq)
    }

    func forward(_ from: String, seq: UInt64, to: String) throws -> String {
        try core().forward(from: from, seq: seq, to: to)
    }

    func block(_ account: String) throws -> Outcome { try core().block(account: account) }

    func unblock(_ account: String) throws { try core().unblock(account: account) }

    func blocked() throws -> [Person] { try core().blocked() }

    func mute(_ conversation: String, for duration: MuteFor) throws -> Mute {
        try core().mute(conversation: conversation, duration: duration)
    }

    func unmute(_ conversation: String) throws { try core().unmute(conversation: conversation) }

    func settings() throws -> Settings { try core().settings() }

    func setSettings(_ settings: Settings) throws { try core().setSettings(settings: settings) }

    func setPushToken(_ token: String, sandbox: Bool) throws { try core().setPushToken(token: token, sandbox: sandbox) }

    func notices() throws -> Notices { try core().notices() }

    func openDirect(_ account: String) throws -> String { try core().openDirect(account: account) }

    func setPhoto(path: String) throws -> String { try core().setPhoto(path: path) }

    func removePhoto() throws { try core().removePhoto() }

    func photo(account: String, version: String) throws -> String? {
        try core().photo(account: account, version: version)
    }
}

/// Runs a blocking core call off the main actor.
func offMain<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
    try await Task.detached(priority: .userInitiated) { try work() }.value
}
