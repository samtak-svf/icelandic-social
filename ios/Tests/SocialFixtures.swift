import SpjallCore

@testable import Spjall

func makeCommunity(
    _ id: String, _ name: String, audience: CommunityAudience = .open, role: CommunityRole? = nil,
    description: String = "", memberCount: UInt64? = 3, mutedUntil: UInt64? = nil, readOnly: Bool = false,
    pendingJoinRequests: UInt64? = nil, openReports: UInt64? = nil, unread: UInt64 = 0,
    lastPostAt: UInt64? = nil, pinned: Bool = false, anonymousPosts: Bool = false, pendingAnonymous: UInt64 = 0,
    featured: [Post] = []
) -> Community {
    Community(
        communityId: id, name: name, description: description, audience: audience, createdAt: FakeAccount.now,
        memberCount: memberCount, role: role, joinRequested: false, invited: false, mutedUntil: mutedUntil,
        readOnly: readOnly, deletedAt: nil, joinDeclinedUntil: nil, pendingJoinRequests: pendingJoinRequests,
        openReports: openReports, unread: unread, lastPostAt: lastPostAt, pinned: pinned,
        anonymousPosts: anonymousPosts, pendingAnonymous: pendingAnonymous, featured: featured)
}

func makePost(
    _ id: String, _ community: String, body: String = "Halló", author: Author? = anna,
    anonymous: Bool = false, own: Bool? = nil, emojis: [EmojiCount] = [], mine: String? = nil,
    comments: UInt64 = 0,
    state: ModerationState = .visible, createdAt: UInt64 = FakeAccount.now, pinned: Bool = false,
    latestComment: Comment? = nil, poll: Poll? = nil
) -> Post {
    Post(
        postId: id, communityId: community, author: author, anonymous: anonymous,
        mine: own ?? (author?.accountId == jon.accountId), body: body, images: [], createdAt: createdAt,
        emojis: emojis, myEmoji: mine, commentCount: comments, latestComment: latestComment, state: state,
        pinned: pinned, poll: poll)
}

/// Somebody in a community's member list.
func makeMember(
    _ account: String, _ name: String? = nil, role: CommunityRole = .member, verified: Bool = false,
    joinedAt: UInt64 = FakeAccount.now, photo: String? = nil
) -> CommunityMember {
    CommunityMember(accountId: account, name: name, verified: verified, role: role, joinedAt: joinedAt, photo: photo)
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
    state: ModerationState = .visible, likes: UInt64 = 0, liked: Bool = false
) -> Comment {
    Comment(
        commentId: id, postId: post, parentCommentId: parent, author: author, body: body,
        createdAt: FakeAccount.now, state: state, likes: likes, liked: liked)
}

/// A report on `target`; `author` is who wrote it, or the account itself, nil when that account is gone.
func makeReport(
    _ id: String, in community: String, _ kind: ReportTargetKind, _ target: String, author: Author? = anna,
    state: ReportState = .open, anonymous: Bool = false
) -> Report {
    Report(
        reportId: id, communityId: community, target: ReportTarget(kind: kind, id: target), targetAccount: author,
        reason: .spam, note: "", state: state, createdAt: FakeAccount.now,
        closedAt: state == .closed ? FakeAccount.now : nil, decision: nil, resolution: nil, closedBy: nil,
        targetAnonymous: anonymous, targetStanding: nil, targetState: nil)
}
