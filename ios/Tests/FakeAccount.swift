import Foundation
import SpjallCore

@testable import Spjall

/// The core as the models see it, in memory. `failNext` makes the next call
/// throw instead, and `calls` records what was asked, in order.
final class FakeAccount: Account, @unchecked Sendable {
    static let kenni = "https://kenni.test/oidc/auth?state=s1"

    private let lock = NSLock()
    private var _calls: [String] = []
    private var _failNext: Error?
    private var _signedIn: Bool
    private var _link: String?
    private var links = 0
    var inviters: [String: Inviter?] = [:]
    /// What the list shows; `createConversation` and `openInvite` add to it.
    var list: [Conversation] {
        get { lock.withLock { _list } }
        set { lock.withLock { _list = newValue } }
    }
    private var _list: [Conversation] = []
    var met: [Person] = []
    /// Invite tokens and the account each one opens a 1:1 with.
    var invites: [String: String] = [:]
    /// What `sync` and `onFrame` return.
    var outcome = Outcome(events: [], frames: [])
    var token: String? = "device-token"
    /// Each conversation's items, oldest first; `send` adds a pending one.
    var timelines: [String: [Item]] {
        get { lock.withLock { _timelines } }
        set { lock.withLock { _timelines = newValue } }
    }
    private var _timelines: [String: [Item]] = [:]
    /// Whether `typing` makes a frame, as the setting does.
    var typingOn = true
    /// What `expire` returns, each once.
    var expired: [Outcome] = []
    private var made = 0
    private var devices = [
        AccountDevice(deviceId: "d1", platform: .ios, createdAt: 1_700_000_000_000, current: true),
        AccountDevice(deviceId: "d2", platform: .android, createdAt: 1_700_000_100_000, current: false),
    ]

    init(signedIn: Bool = false) {
        _signedIn = signedIn
    }

    var calls: [String] { lock.withLock { _calls } }

    var failNext: Error? {
        get { lock.withLock { _failNext } }
        set { lock.withLock { _failNext = newValue } }
    }

    var link: String? {
        get { lock.withLock { _link } }
        set { lock.withLock { _link = newValue } }
    }

    private func call(_ name: String) throws {
        try lock.withLock {
            _calls.append(name)
            if let failure = _failNext {
                _failNext = nil
                throw failure
            }
        }
    }

    func signedIn() throws -> Bool {
        try call("signedIn")
        return lock.withLock { _signedIn }
    }

    func beginSignIn() throws -> String {
        try call("beginSignIn")
        return Self.kenni
    }

    func completeSignIn(callback: String, inviteToken: String?) throws {
        try call("completeSignIn \(callback) \(inviteToken ?? "-")")
        lock.withLock { _signedIn = true }
    }

    func stockKeyPackages() throws { try call("stockKeyPackages") }

    func resolveInvite(token: String) throws -> Inviter? {
        try call("resolveInvite \(token)")
        guard let inviter = inviters[token] else { throw CoreError.Refused(status: 404, code: "not_found") }
        return inviter
    }

    func me() throws -> Me {
        try call("me")
        return lock.withLock { Me(accountId: "a1", name: "Jón Jónsson", verified: true, devices: devices) }
    }

    func inviteLink() throws -> String? {
        try call("inviteLink")
        return link
    }

    func rotateInvite() throws -> String {
        try call("rotateInvite")
        return lock.withLock {
            links += 1
            _link = "https://link.test/l/\(links)"
            return _link!
        }
    }

    func revokeDevice(deviceId: String) throws {
        try call("revokeDevice \(deviceId)")
        lock.withLock {
            if devices.first(where: { $0.deviceId == deviceId })?.current == true { _signedIn = false }
            devices.removeAll { $0.deviceId == deviceId }
        }
    }

    func deleteAccount() throws {
        try call("deleteAccount")
        lock.withLock { _signedIn = false }
    }

    func deviceToken() throws -> String? {
        try call("deviceToken")
        return lock.withLock { token }
    }

    func sync() throws -> Outcome {
        try call("sync")
        return lock.withLock { outcome }
    }

    func onFrame(_ frame: String) throws -> Outcome {
        try call("onFrame \(frame)")
        return lock.withLock { outcome }
    }

    func conversations() throws -> [Conversation] {
        try call("conversations")
        return list
    }

    func people() throws -> [Person] {
        try call("people")
        return met
    }

    func createConversation(with accounts: [String]) throws -> String {
        try call("createConversation \(accounts.joined(separator: ","))")
        return lock.withLock {
            made += 1
            let id = "c\(made)"
            let members = accounts.map { Person(account: $0, name: nil, verified: false) }
            _list.insert(conversation(id, members: members), at: 0)
            return id
        }
    }

    func openInvite(token: String) throws -> String {
        try call("openInvite \(token)")
        guard let inviter = invites[token] else { throw CoreError.Refused(status: 404, code: "not_found") }
        if let open = list.first(where: { $0.members.map(\.account) == [inviter] }) { return open.id }
        return try createConversation(with: [inviter])
    }

    func timeline(_ conversation: String, before: UInt64?, limit: UInt32) throws -> [Item] {
        try call("timeline \(conversation) \(before.map(String.init) ?? "-")")
        let all = timelines[conversation] ?? []
        let older = before.map { before in all.filter { ($0.seq ?? .max) < before } } ?? all
        return Array(older.suffix(Int(limit)))
    }

    func send(_ conversation: String, body: Body) throws -> String {
        try call("send \(conversation) \(body)")
        let id = "e-sent\(calls.count)"
        var pending = item(nil, sender: person("a1", "Jón Jónsson"), own: true, status: .pending)
        pending.envelopeId = id
        timelines[conversation, default: []].append(pending)
        return id
    }

    func retry(_ conversation: String) throws -> Outcome {
        try call("retry \(conversation)")
        return Outcome(events: [], frames: [])
    }

    func markRead(_ conversation: String, seq: UInt64) throws {
        try call("markRead \(conversation) \(seq)")
    }

    func typing(_ conversation: String, active: Bool) throws -> String? {
        try call("typing \(conversation) \(active)")
        return typingOn ? #"{"type":"typing","active":\#(active)}"# : nil
    }

    func expire() throws -> Outcome {
        try call("expire")
        return lock.withLock { expired.isEmpty ? Outcome(events: [], frames: []) : expired.removeFirst() }
    }

    /// Media paths by conversation and seq; a missing one fails the download.
    var files: [String: String] {
        get { lock.withLock { _files } }
        set { lock.withLock { _files = newValue } }
    }
    private var _files: [String: String] = [:]
    var blockedPeople: [Person] {
        get { lock.withLock { _blocked } }
        set { lock.withLock { _blocked = newValue } }
    }
    private var _blocked: [Person] = []
    var current: Settings {
        get { lock.withLock { _settings } }
        set { lock.withLock { _settings = newValue } }
    }
    private var _settings = Settings(readMarkers: true, typing: true)

    func sendMedia(_ conversation: String, path: String, mime: String, caption: String?, name: String?) throws -> String
    {
        let text = (try? String(contentsOfFile: path, encoding: .utf8)) ?? "?"
        try call("sendMedia \(conversation) \(mime) \(name ?? "nil") \(text)")
        return "e-media\(calls.count)"
    }

    func media(_ conversation: String, seq: UInt64) throws -> String {
        try call("media \(conversation) \(seq)")
        guard let path = files["\(conversation) \(seq)"] else { throw CoreError.Invalid(detail: "checksum") }
        return path
    }

    func block(_ account: String) throws -> Outcome {
        try call("block \(account)")
        let person = met.first { $0.account == account } ?? Person(account: account, name: nil, verified: false)
        blockedPeople.insert(person, at: 0)
        return Outcome(events: [], frames: [])
    }

    func unblock(_ account: String) throws {
        try call("unblock \(account)")
        blockedPeople.removeAll { $0.account == account }
    }

    func blocked() throws -> [Person] {
        try call("blocked")
        return blockedPeople
    }

    func settings() throws -> Settings {
        try call("settings")
        return current
    }

    func setSettings(_ settings: Settings) throws {
        try call("setSettings \(settings.readMarkers) \(settings.typing)")
        current = settings
    }

    static let now: UInt64 = 1_700_000_000_000
}

func conversation(
    _ id: String,
    members: [Person],
    state: ConversationState = .active,
    unread: UInt32 = 0
) -> Conversation {
    Conversation(id: id, state: state, members: members, last: nil, unread: unread, timer: nil)
}

func person(_ account: String, _ name: String? = nil) -> Person {
    Person(account: account, name: name, verified: name != nil)
}

let unreachable = CoreError.Unreachable(detail: "URLError -1001")

func item(
    _ seq: UInt64?,
    text: String? = nil,
    sender: Person = person("a2", "Anna"),
    own: Bool = false,
    ts: UInt64? = nil,
    status: ItemStatus = .sent,
    content: Content? = nil,
    reactions: [Reaction] = [],
    readBy: UInt32 = 0,
    expiresAt: UInt64? = nil
) -> Item {
    Item(
        seq: seq,
        envelopeId: seq.map { "e\($0)" },
        sender: sender,
        own: own,
        ts: ts ?? FakeAccount.now + (seq ?? 0) * 1_000,
        status: status,
        content: content ?? .text(text: text ?? "m\(seq.map(String.init) ?? "nil")", replyTo: nil),
        edited: false,
        reactions: reactions,
        readBy: readBy,
        expiresAt: expiresAt
    )
}
