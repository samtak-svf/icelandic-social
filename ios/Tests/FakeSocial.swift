import Foundation
import SpjallCore

@testable import Spjall

/// The hosted social calls as the models see them, in memory. `failNext` makes the next call throw instead,
/// `failOn` fails every call of one name, and `calls` records what was asked, in order.
final class FakeSocial: Social, @unchecked Sendable {
    private let lock = NSLock()
    private var _calls: [String] = []
    private var _failNext: Error?
    private var _failOn: String?
    private var _verified = true
    private var _communities: [String: Community] = [:]
    private var _mine: [String] = []
    private var _posts: [String: [Post]] = [:]
    private var _comments: [String: [Comment]] = [:]
    private var _reports: [String: [Report]] = [:]
    private var _members: [String: [CommunityMember]] = [:]
    private var _log: [String: [ModerationLogEntry]] = [:]
    private var _cards: [String: Card] = [:]
    private var _notifications: [SocialNotification] = []
    private var _joins: [String: JoinState] = [:]
    private var _requests: [String: [JoinRequest]] = [:]
    private var _refuseImage: Error?
    private var made = 0

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

    var verified: Bool {
        get { lock.withLock { _verified } }
        set { lock.withLock { _verified = newValue } }
    }

    /// Every community there is, by id.
    var communities: [String: Community] {
        get { lock.withLock { _communities } }
        set { lock.withLock { _communities = newValue } }
    }

    /// The ids of the communities this account is in, in the order `myCommunities` gives them.
    var mine: [String] {
        get { lock.withLock { _mine } }
        set { lock.withLock { _mine = newValue } }
    }

    /// Each community's posts, newest first.
    var posts: [String: [Post]] {
        get { lock.withLock { _posts } }
        set { lock.withLock { _posts = newValue } }
    }

    /// Each post's comments, oldest first.
    var comments: [String: [Comment]] {
        get { lock.withLock { _comments } }
        set { lock.withLock { _comments = newValue } }
    }

    /// Each community's reports, open and closed, oldest first.
    var reports: [String: [Report]] {
        get { lock.withLock { _reports } }
        set { lock.withLock { _reports = newValue } }
    }

    /// Each community's member list, in the order `communityMembers` gives it.
    var members: [String: [CommunityMember]] {
        get { lock.withLock { _members } }
        set { lock.withLock { _members = newValue } }
    }

    /// Each community's moderation log, newest first.
    var log: [String: [ModerationLogEntry]] {
        get { lock.withLock { _log } }
        set { lock.withLock { _log = newValue } }
    }

    /// The card each id resolves to; one not here is unavailable.
    var cards: [String: Card] {
        get { lock.withLock { _cards } }
        set { lock.withLock { _cards = newValue } }
    }

    /// This account's notifications, newest first.
    var notifications: [SocialNotification] {
        get { lock.withLock { _notifications } }
        set { lock.withLock { _notifications = newValue } }
    }

    /// What joining each community answers; an open one makes a member by default, a private one a request.
    var joins: [String: JoinState] {
        get { lock.withLock { _joins } }
        set { lock.withLock { _joins = newValue } }
    }

    /// The join requests that wait in each community, oldest first.
    var requests: [String: [JoinRequest]] {
        get { lock.withLock { _requests } }
        set { lock.withLock { _requests = newValue } }
    }

    /// What `uploadPostImage` throws, each time, while this is set.
    var refuseImage: Error? {
        get { lock.withLock { _refuseImage } }
        set { lock.withLock { _refuseImage = newValue } }
    }

    /// How long one page is here, so the tests see more than one without making dozens.
    var pageSize = 2

    private func call(_ name: String) throws {
        try lock.withLock {
            _calls.append(name)
            if let failure = _failNext {
                _failNext = nil
                throw failure
            }
            if name.split(separator: " ").first.map(String.init) == _failOn { throw unreachable }
        }
    }

    /// The page of `items` after the cursor `after` (an index, as text), and the cursor of the next.
    private func page<T>(_ items: [T], after: String?) -> ([T], String?) {
        let start = after.flatMap { Int($0) } ?? 0
        let end = min(start + pageSize, items.count)
        guard start < end else { return ([], nil) }
        return (Array(items[start..<end]), end < items.count ? String(end) : nil)
    }

    func me() throws -> Me {
        try call("me")
        return Me(accountId: "a1", name: "Jón Jónsson", verified: verified, devices: [], photo: nil)
    }

    func communities(query: String?, after: String?, limit: UInt32) throws -> CommunityPage {
        try call("communities \(query ?? "-") \(after ?? "-")")
        let all = communities.values
            .filter { query == nil || $0.name.localizedCaseInsensitiveContains(query!) }
            .sorted { $0.name < $1.name }
        let (found, next) = page(all, after: after)
        return CommunityPage(communities: found, next: next)
    }

    func myCommunities() throws -> [Community] {
        try call("myCommunities")
        let all = communities
        return mine.compactMap { all[$0] }
    }

    func createCommunity(name: String, description: String, audience: CommunityAudience) throws -> Community {
        try call("createCommunity \(name)")
        let id = lock.withLock {
            made += 1
            return "made\(made)"
        }
        let created = makeCommunity(id, name, audience: audience, role: .owner, description: description)
        communities[id] = created
        mine.insert(id, at: 0)
        return created
    }

    func community(_ id: String) throws -> Community {
        try call("community \(id)")
        guard let found = communities[id] else { throw notFound }
        return found
    }

    func joinCommunity(_ id: String) throws -> JoinState {
        try call("joinCommunity \(id)")
        guard var found = communities[id] else { throw notFound }
        let state = joins[id] ?? (found.audience == .open ? .member : .requested)
        switch state {
        case .member:
            found.role = .member
            mine.append(id)
        case .requested:
            found.joinRequested = true
        }
        communities[id] = found
        return state
    }

    func leaveCommunity(_ id: String) throws {
        try call("leaveCommunity \(id)")
        guard var found = communities[id] else { throw notFound }
        found.role = nil
        communities[id] = found
        mine.removeAll { $0 == id }
    }

    func withdrawJoinRequest(_ id: String) throws {
        try call("withdrawJoinRequest \(id)")
        guard var found = communities[id] else { throw notFound }
        found.joinRequested = false
        communities[id] = found
    }

    func joinRequests(_ community: String) throws -> [JoinRequest] {
        try call("joinRequests \(community)")
        return requests[community] ?? []
    }

    func approveJoinRequest(_ community: String, account: String) throws {
        try call("approveJoinRequest \(community) \(account)")
        requests[community]?.removeAll { $0.accountId == account }
    }

    func declineJoinRequest(_ community: String, account: String) throws {
        try call("declineJoinRequest \(community) \(account)")
        requests[community]?.removeAll { $0.accountId == account }
    }

    func deleteCommunity(_ id: String) throws {
        try call("deleteCommunity \(id)")
        guard communities[id] != nil else { throw notFound }
        communities[id] = nil
        mine.removeAll { $0 == id }
    }

    func communityMembers(_ community: String) throws -> [CommunityMember] {
        try call("communityMembers \(community)")
        return members[community] ?? []
    }

    func setCommunityRole(_ community: String, account: String, role: CommunityRole) throws {
        try call("setCommunityRole \(community) \(account) \(role)")
        members[community] = (members[community] ?? []).map { found in
            var found = found
            if found.accountId == account { found.role = role }
            return found
        }
    }

    func updateCommunity(_ community: String, name: String?, description: String?, audience: CommunityAudience?)
        throws -> Community
    {
        try call(
            "updateCommunity \(community) \(name ?? "-") \(description ?? "-")"
                + (audience.map { " \($0 == .open ? "open" : "private")" } ?? ""))
        guard var found = communities[community] else { throw notFound }
        if let name { found.name = name }
        if let description { found.description = description }
        if let audience { found.audience = audience }
        communities[community] = found
        return found
    }

    func communityModerationLog(_ community: String, before: String?, limit: UInt32) throws -> ModerationLogPage {
        try call("communityModerationLog \(community) \(before ?? "-")")
        let (found, next) = page(log[community] ?? [], after: before)
        return ModerationLogPage(entries: found, next: next)
    }

    func communityPosts(_ community: String, before: String?, limit: UInt32, query: String?) throws -> PostPage {
        try call("communityPosts \(community) \(before ?? "-")" + (query.map { " q:\($0)" } ?? ""))
        let all = (posts[community] ?? []).filter {
            query == nil || $0.body.localizedCaseInsensitiveContains(query!)
        }
        let (found, next) = page(all, after: before)
        return PostPage(posts: found, next: next)
    }

    func feed(before: String?, limit: UInt32) throws -> PostPage {
        try call("feed \(before ?? "-")")
        let all = mine.flatMap { posts[$0] ?? [] }.sorted { $0.createdAt > $1.createdAt }
        let (found, next) = page(all, after: before)
        return PostPage(posts: found, next: next)
    }

    func createPost(_ community: String, body: String, media: [String]) throws -> Post {
        try call("createPost \(community) \(body)" + (media.isEmpty ? "" : " \(media.joined(separator: ","))"))
        let id = lock.withLock {
            made += 1
            return "p-made\(made)"
        }
        let me = Author(accountId: "a1", name: "Jón Jónsson", verified: true)
        var created = makePost(id, community, body: body, author: me)
        created.images = media.map { PostImage(mediaId: $0, width: 640, height: 480) }
        posts[community, default: []].insert(created, at: 0)
        return created
    }

    func uploadPostImage(_ community: String, path: String) throws -> PostImage {
        let name = URL(filePath: path).lastPathComponent
        try call("uploadPostImage \(community) \(name)")
        if let refused = refuseImage { throw refused }
        return PostImage(mediaId: "m-\(name)", width: 640, height: 480)
    }

    func postImage(_ post: String, media: String) throws -> String {
        try call("postImage \(post) \(media)")
        return "/images/\(media).webp"
    }

    func deletePost(_ id: String) throws {
        try call("deletePost \(id)")
        for community in posts.keys { posts[community]?.removeAll { $0.postId == id } }
    }

    func post(_ id: String) throws -> Post {
        try call("post \(id)")
        guard let found = posts.values.joined().first(where: { $0.postId == id }) else { throw notFound }
        return found
    }

    func react(_ post: String, kind: ReactionKind) throws {
        try call("react \(post) \(kind)")
    }

    func unreact(_ post: String) throws {
        try call("unreact \(post)")
    }

    func comments(_ post: String, after: String?, limit: UInt32) throws -> CommentPage {
        try call("comments \(post) \(after ?? "-")")
        let (found, next) = page(comments[post] ?? [], after: after)
        return CommentPage(comments: found, next: next)
    }

    func createComment(_ post: String, body: String, parentCommentId: String?) throws -> Comment {
        try call("createComment \(post) \(body)" + (parentCommentId.map { " on \($0)" } ?? ""))
        let created = Comment(
            commentId: "c\(post)-\((comments[post] ?? []).count + 1)", postId: post,
            parentCommentId: parentCommentId,
            author: Author(accountId: "a1", name: "Jón Jónsson", verified: true), body: body,
            createdAt: FakeAccount.now, state: .visible)
        comments[post, default: []].append(created)
        return created
    }

    func deleteComment(_ id: String) throws {
        try call("deleteComment \(id)")
        for post in comments.keys { comments[post]?.removeAll { $0.commentId == id } }
    }

    func report(_ target: ReportTarget, reason: ReportReason, note: String) throws {
        try call("report \(target.kind) \(target.id) \(reason) \(note)")
    }

    func reports(_ community: String, state: ReportState, after: String?, limit: UInt32) throws -> ReportPage {
        try call("reports \(community) \(state) \(after ?? "-")")
        let (found, next) = page((reports[community] ?? []).filter { $0.state == state }, after: after)
        return ReportPage(reports: found, next: next)
    }

    func moderate(
        _ community: String, action: ModerationAction, target: String, reason: String, report: String?,
        until: UInt64?
    ) throws {
        try call(
            "moderate \(community) \(action) \(target) \(reason) \(report ?? "-")" + (until.map { " \($0)" } ?? ""))
        if let report { close(report) }
    }

    func closeReport(_ report: String, resolution: String) throws {
        try call("closeReport \(report) \(resolution)")
        close(report)
    }

    /// The report leaves the open queue for the closed one.
    private func close(_ report: String) {
        reports = reports.mapValues { all in
            all.map { found in
                var found = found
                if found.reportId == report {
                    found.state = .closed
                    found.closedAt = FakeAccount.now
                }
                return found
            }
        }
    }

    func cards(_ refs: [CardRef]) throws -> [Card] {
        try call("cards \(refs.map(\.id).joined(separator: ","))")
        let all = cards
        return refs.map { all[$0.id] ?? .unavailable(reference: $0) }
    }

    func notifications(before: String?, limit: UInt32) throws -> SocialNotificationPage {
        try call("notifications \(before ?? "-")")
        let all = notifications
        let (found, next) = page(all, after: before)
        return SocialNotificationPage(
            notifications: found, unread: UInt64(all.filter { !$0.read }.count), next: next)
    }

    func readNotifications(upTo: UInt64) throws {
        try call("readNotifications \(upTo)")
        notifications = notifications.map { notice in
            var notice = notice
            if notice.createdAt <= upTo { notice.read = true }
            return notice
        }
    }
}

func makeCommunity(
    _ id: String, _ name: String, audience: CommunityAudience = .open, role: CommunityRole? = nil,
    description: String = "", memberCount: UInt64? = 3, mutedUntil: UInt64? = nil, readOnly: Bool = false,
    pendingJoinRequests: UInt64? = nil, openReports: UInt64? = nil
) -> Community {
    Community(
        communityId: id, name: name, description: description, audience: audience, createdAt: FakeAccount.now,
        memberCount: memberCount, role: role, joinRequested: false, invited: false, mutedUntil: mutedUntil,
        readOnly: readOnly, deletedAt: nil, joinDeclinedUntil: nil, pendingJoinRequests: pendingJoinRequests,
        openReports: openReports)
}

func makePost(
    _ id: String, _ community: String, body: String = "Halló", author: Author = anna,
    reactions: [ReactionCount] = [], mine: ReactionKind? = nil, comments: UInt64 = 0,
    state: ModerationState = .visible, createdAt: UInt64 = FakeAccount.now
) -> Post {
    Post(
        postId: id, communityId: community, author: author, body: body, images: [], createdAt: createdAt,
        reactions: reactions, myReaction: mine, commentCount: comments, state: state)
}

/// Somebody in a community's member list.
func makeMember(
    _ account: String, _ name: String? = nil, role: CommunityRole = .member, verified: Bool = false,
    joinedAt: UInt64 = FakeAccount.now
) -> CommunityMember {
    CommunityMember(accountId: account, name: name, verified: verified, role: role, joinedAt: joinedAt, photo: nil)
}

/// One action in a community's moderation log.
func makeLogEntry(
    _ id: UInt64, _ action: ModerationLogAction, target: LogTarget = LogTarget(kind: .post, id: "p1"),
    actor: Author? = anna, targetAccount: Author? = nil, reason: String = ""
) -> ModerationLogEntry {
    ModerationLogEntry(
        entryId: id, communityId: "k1", actor: actor, asPlatform: false, action: action, target: target,
        targetAccount: targetAccount, reason: reason, createdAt: FakeAccount.now)
}

/// Someone else in the communities.
let anna = Author(accountId: "a2", name: "Anna", verified: false)

/// This account, as its own posts and comments name it.
let jon = Author(accountId: "a1", name: "Jón Jónsson", verified: true)

func makeComment(
    _ id: String, on post: String, body: String = "Já", author: Author = anna, parent: String? = nil,
    state: ModerationState = .visible
) -> Comment {
    Comment(
        commentId: id, postId: post, parentCommentId: parent, author: author, body: body,
        createdAt: FakeAccount.now, state: state)
}

/// A report on `target`; `author` is who wrote it, or the account itself, nil when that account is gone.
func makeReport(
    _ id: String, in community: String, _ kind: ReportTargetKind, _ target: String, author: Author? = anna,
    state: ReportState = .open
) -> Report {
    Report(
        reportId: id, communityId: community, target: ReportTarget(kind: kind, id: target), targetAccount: author,
        reason: .spam, note: "", state: state, createdAt: FakeAccount.now,
        closedAt: state == .closed ? FakeAccount.now : nil, decision: nil, resolution: nil, closedBy: nil,
        targetStanding: nil, targetState: nil)
}

func makeNotice(
    _ id: String, _ kind: SocialNotificationKind, actor: Author? = nil, community: String = "k1",
    post: String? = nil, read: Bool = false, createdAt: UInt64 = FakeAccount.now
) -> SocialNotification {
    SocialNotification(
        notificationId: id, kind: kind, actor: actor, communityId: community, postId: post, commentId: nil,
        action: nil, createdAt: createdAt, read: read)
}
