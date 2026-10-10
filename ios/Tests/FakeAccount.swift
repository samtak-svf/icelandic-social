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
        return lock.withLock { Me(accountId: "a1", name: "Jón Jónsson", verified: _verified, devices: devices) }
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

    /// Fljótið, newest first; `createPost` adds to the top. A wall is the posts of one author.
    var posts: [Post] {
        get { lock.withLock { _posts } }
        set { lock.withLock { _posts = newValue } }
    }
    private var _posts: [Post] = []
    /// Each post's replies, oldest first.
    var postReplies: [String: [Reply]] {
        get { lock.withLock { _replies } }
        set { lock.withLock { _replies = newValue } }
    }
    private var _replies: [String: [Reply]] = [:]
    /// Who `profile` says an account is; one not here is nameless.
    var profiles: [String: Person] = [:]
    private var written = 0

    func feed(before: String?, limit: UInt32) throws -> PostPage {
        try call("feed \(before ?? "-")")
        return Self.page(posts, before, limit)
    }

    func wall(account: String, before: String?, limit: UInt32) throws -> PostPage {
        try call("wall \(account) \(before ?? "-")")
        return Self.page(posts.filter { $0.author.account == account }, before, limit)
    }

    func post(_ postId: String) throws -> Post {
        try call("post \(postId)")
        guard let post = posts.first(where: { $0.postId == postId }) else {
            throw notFound
        }
        return post
    }

    func createPost(body: String) throws -> Post {
        try call("createPost \(body)")
        let post = lock.withLock {
            written += 1
            return samplePost("p-new\(written)", author: person("a1", "Jón Jónsson"), body: body)
        }
        posts.insert(post, at: 0)
        return post
    }

    func deletePost(_ postId: String) throws {
        try call("deletePost \(postId)")
        posts.removeAll { $0.postId == postId }
    }

    func reactToPost(_ postId: String, reaction: PostReaction?) throws {
        try call("reactToPost \(postId) \(reaction.map { "\($0)" } ?? "nil")")
    }

    func replies(_ postId: String, after: String?, limit: UInt32) throws -> ReplyPage {
        try call("replies \(postId) \(after ?? "-")")
        let all = postReplies[postId] ?? []
        let start = after.flatMap(Int.init) ?? 0
        let end = min(all.count, start + Int(limit))
        return ReplyPage(replies: Array(all[start..<end]), next: end < all.count ? String(end) : nil)
    }

    func createReply(_ postId: String, body: String) throws -> Reply {
        try call("createReply \(postId) \(body)")
        let reply = lock.withLock {
            written += 1
            return sampleReply("r-new\(written)", postId: postId, author: person("a1", "Jón Jónsson"), body: body)
        }
        postReplies[postId, default: []].append(reply)
        return reply
    }

    func deleteReply(_ replyId: String) throws {
        try call("deleteReply \(replyId)")
        lock.withLock {
            for key in _replies.keys { _replies[key]?.removeAll { $0.replyId == replyId } }
        }
    }

    func profile(_ account: String) throws -> Person {
        try call("profile \(account)")
        return profiles[account] ?? Person(account: account, name: nil, verified: false)
    }

    func openDirect(_ account: String) throws -> String {
        try call("openDirect \(account)")
        if let open = list.first(where: { $0.members.map(\.account) == [account] }) { return open.id }
        return try createConversation(with: [account])
    }

    /// `limit` posts from the index `before` names; `next` is the index after them.
    private static func page(_ posts: [Post], _ before: String?, _ limit: UInt32) -> PostPage {
        let start = before.flatMap(Int.init) ?? 0
        let end = min(posts.count, start + Int(limit))
        return PostPage(posts: Array(posts[start..<end]), next: end < posts.count ? String(end) : nil)
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

func samplePost(
    _ id: String,
    author: Person = person("a2", "Anna"),
    body: String? = nil,
    replies: UInt32 = 0,
    hearts: UInt32 = 0,
    mine: PostReaction? = nil
) -> Post {
    Post(
        postId: id,
        author: author,
        body: body ?? "body of \(id)",
        createdAt: FakeAccount.now,
        replyCount: replies,
        reactions: ReactionCounts(heart: hearts, thumbsUp: 0, laugh: 0, wow: 0, sad: 0),
        myReaction: mine
    )
}

func sampleReply(_ id: String, postId: String, author: Person = person("a2", "Anna"), body: String? = nil) -> Reply {
    Reply(replyId: id, postId: postId, author: author, body: body ?? "reply \(id)", createdAt: FakeAccount.now)
}
