import Foundation
import SpjallCore

@testable import Spjall

/// The core as the models see it, in memory. `failNext` makes the next call
/// throw instead, and `calls` records what was asked, in order.
final class FakeAccount: Account, @unchecked Sendable {
    static let kenni = "https://kenni.test/oidc/auth?state=s1"
    static let google = "https://google.test/o/oauth2/auth?state=s1"

    static func url(_ provider: SignInProvider) -> String { provider == .google ? google : kenni }

    private let lock = NSLock()
    private var _calls: [String] = []
    private var _failNext: Error?
    private var _signedIn: Bool
    private var _verified = true
    /// Whether Kenni vouches for the account; a link sets it.
    var verified: Bool {
        get { lock.withLock { _verified } }
        set { lock.withLock { _verified = newValue } }
    }
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
    /// Everyone else signed in, as the directory lists them.
    var everyone: [Person] = []
    /// Invite tokens and the account each one opens a 1:1 with.
    var invites: [String: String] = [:]
    /// What `sync` and `onFrame` return.
    var outcome = Outcome(events: [], frames: [])
    /// What the next `notices` returns; it is then empty, as the core gives each notice once.
    var nextNotices: Notices {
        get { lock.withLock { _notices } }
        set { lock.withLock { _notices = newValue } }
    }
    private var _notices = Notices(shown: [], cleared: [])
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

    /// A call that fails each time it is made, unlike `failNext`, while this is set.
    var failOn: String? {
        get { lock.withLock { _failOn } }
        set { lock.withLock { _failOn = newValue } }
    }
    private var _failOn: String?

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
            if name == _failOn { throw unreachable }
        }
    }

    func signedIn() throws -> Bool {
        try call("signedIn")
        return lock.withLock { _signedIn }
    }

    func beginSignIn(provider: SignInProvider) throws -> String {
        try call("beginSignIn \(provider)")
        return Self.url(provider)
    }

    func beginLink(provider: SignInProvider) throws -> String {
        try call("beginLink \(provider)")
        return Self.url(provider)
    }

    /// Whether the next link joins this device to the older account holding the kennitala (decision 0035).
    var joins = false

    func completeLink(callback: String) throws -> Bool {
        try call("completeLink \(callback)")
        lock.withLock { _verified = true }
        return joins
    }

    func completeSignIn(callback: String, inviteToken: String?) throws {
        try call("completeSignIn \(callback) \(inviteToken ?? "-")")
        lock.withLock { _signedIn = true }
    }

    /// Recorded, but never the call `failNext` hits: the model runs it detached
    /// after a sign-in and ignores its failure, so it would take a failure meant
    /// for the call under test whenever it ran first.
    func stockKeyPackages() throws { lock.withLock { _calls.append("stockKeyPackages") } }

    func resolveInvite(token: String) throws -> Inviter? {
        try call("resolveInvite \(token)")
        guard let inviter = inviters[token] else { throw notFound }
        return inviter
    }

    func me() throws -> Me {
        try call("me")
        return lock.withLock {
            Me(accountId: "a1", name: "Jón Jónsson", verified: _verified, devices: devices, photo: _myPhoto)
        }
    }

    /// The version of this account's photo, as `me` gives it; `setPhoto` and `removePhoto` change it.
    var myPhoto: String? {
        get { lock.withLock { _myPhoto } }
        set { lock.withLock { _myPhoto = newValue } }
    }
    private var _myPhoto: String?
    private var photoVersions = 0
    /// The bytes of each photo `setPhoto` was given, read while the file was there.
    var uploaded: [Data] { lock.withLock { _uploaded } }
    private var _uploaded: [Data] = []
    /// The core's file for each account's photo, by "account/version"; one not here has none.
    var photoFiles: [String: String] {
        get { lock.withLock { _photoFiles } }
        set { lock.withLock { _photoFiles = newValue } }
    }
    private var _photoFiles: [String: String] = [:]

    func setPhoto(path: String) throws -> String {
        try call("setPhoto")
        let bytes = try Data(contentsOf: URL(filePath: path))
        return lock.withLock {
            _uploaded.append(bytes)
            photoVersions += 1
            _myPhoto = "v\(photoVersions)"
            return "v\(photoVersions)"
        }
    }

    func removePhoto() throws {
        try call("removePhoto")
        lock.withLock { _myPhoto = nil }
    }

    func photo(account: String, version: String) throws -> String? {
        try call("photo \(account) \(version)")
        return lock.withLock { _photoFiles["\(account)/\(version)"] }
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

    /// As the core matches: the start of a name, or of a word in it after a space or a hyphen (decision 0038).
    func searchConversations(_ query: String) throws -> [Conversation] {
        try call("searchConversations \(query)")
        return matching(query)
    }

    /// As the core does: the conversations found, then the directory without anyone whose 1:1 is among them.
    func searchList(_ query: String, limit: UInt32) throws -> ListSearch {
        try call("searchList \(query)")
        let found = matching(query)
        let shown = Set(found.compactMap { $0.members.count == 1 ? $0.members[0].account : nil })
        let people = everyone.filter {
            ($0.name ?? "").localizedCaseInsensitiveContains(query) && !shown.contains($0.account)
        }
        return ListSearch(conversations: found, people: Array(people.prefix(Int(limit))))
    }

    private func matching(_ query: String) -> [Conversation] {
        let search = query.trimmingCharacters(in: .whitespaces).lowercased()
        return list.filter { conversation in
            conversation.members.contains { person in
                let name = (person.name ?? "").lowercased()
                return name.hasPrefix(search) || name.contains(" \(search)") || name.contains("-\(search)")
            }
        }
    }

    func people() throws -> [Person] {
        try call("people")
        return met
    }

    func directory(query: String?, after: String?, limit: UInt32) throws -> PersonPage {
        try call("directory \(query ?? "-") \(after ?? "-")")
        let found = everyone.filter { query == nil || ($0.name ?? "").localizedCaseInsensitiveContains(query!) }
        let start = after.flatMap(Int.init) ?? 0
        let end = min(start + Int(limit), found.count)
        return PersonPage(people: Array(found[start..<end]), next: end < found.count ? String(end) : nil)
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
        guard let inviter = invites[token] else { throw notFound }
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

    func forward(_ from: String, seq: UInt64, to: String) throws -> String {
        try call("forward \(from) \(seq) \(to)")
        return "e-forward\(calls.count)"
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

    /// The server sets the end by its clock: here an hour or eight after `now`.
    func mute(_ conversation: String, for duration: MuteFor) throws -> Mute {
        try call("mute \(conversation) \(duration)")
        let hour: UInt64 = 3_600_000
        let mute: Mute =
            switch duration {
            case .hour: .until(at: Self.now + hour)
            case .eightHours: .until(at: Self.now + 8 * hour)
            case .always: .always
            }
        setMute(conversation, mute)
        return mute
    }

    func unmute(_ conversation: String) throws {
        try call("unmute \(conversation)")
        setMute(conversation, .off)
    }

    private func setMute(_ conversation: String, _ mute: Mute) {
        list = list.map {
            var changed = $0
            if changed.id == conversation { changed.mute = mute }
            return changed
        }
    }

    func settings() throws -> Settings {
        try call("settings")
        return current
    }

    func setSettings(_ settings: Settings) throws {
        try call("setSettings \(settings.readMarkers) \(settings.typing)")
        current = settings
    }

    func setPushToken(_ token: String, sandbox: Bool) throws {
        try call("setPushToken \(token) \(sandbox)")
    }

    func notices() throws -> Notices {
        try call("notices")
        return lock.withLock {
            defer { _notices = Notices(shown: [], cleared: []) }
            return _notices
        }
    }

    func openDirect(_ account: String) throws -> String {
        try call("openDirect \(account)")
        if let open = list.first(where: { $0.members.map(\.account) == [account] }) { return open.id }
        return try createConversation(with: [account])
    }

    static let now: UInt64 = 1_700_000_000_000
}

func conversation(
    _ id: String,
    members: [Person],
    state: ConversationState = .active,
    unread: UInt32 = 0
) -> Conversation {
    Conversation(id: id, state: state, members: members, last: nil, unread: unread, timer: nil, mute: .off)
}

func person(_ account: String, _ name: String? = nil) -> Person {
    Person(account: account, name: name, verified: name != nil)
}

let unreachable = CoreError.Unreachable(detail: "URLError -1001")
let notFound = CoreError.Refused(status: 404, code: "not_found", requestId: nil)

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
    expiresAt: UInt64? = nil,
    forwarded: Bool = false
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
        expiresAt: expiresAt,
        forwarded: forwarded
    )
}
