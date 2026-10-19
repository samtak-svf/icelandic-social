import Foundation
import SpjallCore

/// Hosted content (decisions 0060, 0063): communities, their posts, comments and reactions, reports, moderation
/// and the notifications addressed to this account. The server reads all of it to serve it to its audience, so
/// it is kept apart from `Account`, whose conversations are end-to-end encrypted: nothing here is written to the
/// conversation store or to the device at all. Every call asks the server and blocks on the network, so the
/// models make them off the main actor.
protocol Social: Sendable {
    /// Whether Kenni vouches for this account: only a verified one creates a community (0063).
    func me() throws -> Me
    /// A page of the communities this account may see, by name when `query` is set.
    func communities(query: String?, after: String?, limit: UInt32) throws -> CommunityPage
    /// Every community this account is a member of.
    func myCommunities() throws -> [Community]
    func createCommunity(name: String, description: String, audience: CommunityAudience) throws -> Community
    func community(_ id: String) throws -> Community
    /// Joins an open community at once, or asks a private one's moderators.
    func joinCommunity(_ id: String) throws -> JoinState
    func leaveCommunity(_ id: String) throws
    /// A page of a community's posts, newest first.
    func communityPosts(_ community: String, before: String?, limit: UInt32) throws -> PostPage
    func createPost(_ community: String, body: String) throws -> Post
    func post(_ id: String) throws -> Post
    /// Sets this account's one reaction on a post, in place of any other.
    func react(_ post: String, kind: ReactionKind) throws
    func unreact(_ post: String) throws
    /// A page of a post's comments, oldest first.
    func comments(_ post: String, after: String?, limit: UInt32) throws -> CommentPage
    func createComment(_ post: String, body: String) throws -> Comment
    /// Reports to the moderators, who are never told who reported; the server sends what is unlawful to the
    /// platform's own.
    func report(_ target: ReportTarget, reason: ReportReason, note: String) throws
    /// A page of a community's open reports, for its moderators.
    func openReports(_ community: String, after: String?, limit: UInt32) throws -> ReportPage
    /// One moderator's action on a post or a comment, answering `report` when there is one.
    func moderate(_ community: String, action: ModerationAction, target: String, reason: String, report: String?)
        throws
    func closeReport(_ report: String, resolution: String) throws
    /// What each reference shows, one card each in their order.
    func cards(_ refs: [CardRef]) throws -> [Card]
    /// A page of this account's notifications, newest first, with how many are unread.
    func notifications(before: String?, limit: UInt32) throws -> SocialNotificationPage
    /// Marks read every notification made at or before `upTo`.
    func readNotifications(upTo: UInt64) throws
}

extension CoreAccount: Social {
    func communities(query: String?, after: String?, limit: UInt32) throws -> CommunityPage {
        try core().communities(query: query, after: after, limit: limit)
    }

    func myCommunities() throws -> [Community] { try core().myCommunities() }

    func createCommunity(name: String, description: String, audience: CommunityAudience) throws -> Community {
        try core().createCommunity(name: name, description: description, audience: audience)
    }

    func community(_ id: String) throws -> Community { try core().community(communityId: id) }

    func joinCommunity(_ id: String) throws -> JoinState { try core().joinCommunity(communityId: id) }

    func leaveCommunity(_ id: String) throws { try core().leaveCommunity(communityId: id) }

    func communityPosts(_ community: String, before: String?, limit: UInt32) throws -> PostPage {
        try core().communityPosts(communityId: community, before: before, limit: limit)
    }

    func createPost(_ community: String, body: String) throws -> Post {
        try core().createPost(communityId: community, body: body, media: [])
    }

    func post(_ id: String) throws -> Post { try core().post(postId: id) }

    func react(_ post: String, kind: ReactionKind) throws { try core().react(postId: post, kind: kind) }

    func unreact(_ post: String) throws { try core().unreact(postId: post) }

    func comments(_ post: String, after: String?, limit: UInt32) throws -> CommentPage {
        try core().comments(postId: post, after: after, limit: limit)
    }

    func createComment(_ post: String, body: String) throws -> Comment {
        try core().createComment(postId: post, body: body)
    }

    func report(_ target: ReportTarget, reason: ReportReason, note: String) throws {
        try core().report(target: target, reason: reason, note: note, toPlatform: false)
    }

    func openReports(_ community: String, after: String?, limit: UInt32) throws -> ReportPage {
        try core().communityReports(communityId: community, state: .open, after: after, limit: limit)
    }

    func moderate(_ community: String, action: ModerationAction, target: String, reason: String, report: String?)
        throws
    {
        try core().moderate(
            communityId: community, action: action, targetId: target, reason: reason, reportId: report, until: nil)
    }

    func closeReport(_ report: String, resolution: String) throws {
        try core().closeReport(reportId: report, resolution: resolution)
    }

    func cards(_ refs: [CardRef]) throws -> [Card] { try core().cards(refs: refs) }

    func notifications(before: String?, limit: UInt32) throws -> SocialNotificationPage {
        try core().notifications(before: before, limit: limit)
    }

    func readNotifications(upTo: UInt64) throws { try core().readNotifications(upTo: upTo) }
}

/// Where a hosted screen leads: a community, a post, or a community's report queue.
enum SocialRoute: Hashable {
    case community(String)
    case post(String)
    case reports(String)
}

/// The five reactions a post takes, in the order they are offered.
let reactionKinds: [ReactionKind] = [.like, .love, .laugh, .wow, .sad]

/// The reasons a report gives, in the order they are offered.
let reportReasons: [ReportReason] = [.unlawful, .harassment, .spam, .other]

/// Now, in Unix milliseconds, as the server counts.
@Sendable func nowMillis() -> UInt64 {
    UInt64(Date().timeIntervalSince1970 * 1_000)
}

/// Who wrote it or did it: their name, a word for none, or another for an account deleted since.
func authorName(_ author: Author?) -> String {
    guard let author else { return localized("person_deleted") }
    return author.name ?? localized("person_unnamed")
}

/// A community's audience, and how many members it has when this account may know.
func audienceLine(_ community: Community) -> String {
    let audience = localized(community.audience == .open ? "community_open" : "community_private")
    guard let count = community.memberCount else { return audience }
    return "\(audience) · \(plural("community_members", Int(count)))"
}

/// The words for a reaction, which a screen reader says in place of its emoji.
func reactionLabel(_ kind: ReactionKind) -> String {
    switch kind {
    case .like: localized("reaction_like")
    case .love: localized("reaction_love")
    case .laugh: localized("reaction_laugh")
    case .wow: localized("reaction_wow")
    case .sad: localized("reaction_sad")
    }
}

/// A reaction as the button shows it.
func reactionEmoji(_ kind: ReactionKind) -> String {
    switch kind {
    case .like: "👍"
    case .love: "❤️"
    case .laugh: "😂"
    case .wow: "😮"
    case .sad: "😢"
    }
}

func reasonLabel(_ reason: ReportReason) -> String {
    switch reason {
    case .unlawful: localized("report_reason_unlawful")
    case .harassment: localized("report_reason_harassment")
    case .spam: localized("report_reason_spam")
    case .other: localized("report_reason_other")
    }
}

/// What a notification tells, in one line.
func noticeLine(_ notification: SocialNotification) -> String {
    switch notification.kind {
    case .comment: localized("notice_comment", authorName(notification.actor))
    case .reaction: localized("notice_reaction", authorName(notification.actor))
    case .joinApproved: localized("notice_join_approved")
    case .moderated: localized("notice_moderated")
    }
}

/// Where a notification opens: its post, or its community when it has no post or the post was moderated away.
func noticeRoute(_ notification: SocialNotification) -> SocialRoute {
    if let post = notification.postId, notification.kind != .moderated { return .post(post) }
    return .community(notification.communityId)
}

/// `post` with this account's reaction set to `kind`, or taken off for nil, and the counts moved to match.
func reacted(_ post: Post, _ kind: ReactionKind?) -> Post {
    var changed = post
    var counts = post.reactions
    if let old = post.myReaction, let index = counts.firstIndex(where: { $0.kind == old }) {
        counts[index].count -= min(counts[index].count, 1)
    }
    if let kind {
        if let index = counts.firstIndex(where: { $0.kind == kind }) {
            counts[index].count += 1
        } else {
            counts.append(ReactionCount(kind: kind, count: 1))
        }
    }
    changed.reactions = counts.filter { $0.count > 0 }
    changed.myReaction = kind
    return changed
}

/// How many of `kind` a post has.
func reactionCount(_ post: Post, _ kind: ReactionKind) -> UInt64 {
    post.reactions.first { $0.kind == kind }?.count ?? 0
}

/// Whether this account may post, comment and react in `community`: a member, in a community that is not
/// read-only, and not muted there (0063).
func canWrite(_ community: Community, now: UInt64) -> Bool {
    community.role != nil && !community.readOnly && !isMuted(community, now: now)
}

/// A moderator muted this account in `community`, and the mute has not ended.
func isMuted(_ community: Community, now: UInt64) -> Bool {
    community.role != nil && (community.mutedUntil.map { $0 > now } ?? false)
}

/// The card's reference, whatever it shows.
func reference(_ card: Card) -> CardRef {
    switch card {
    case .unavailable(let reference): reference
    case .post(let reference, _, _, _, _, _): reference
    case .comment(let reference, _, _, _, _, _): reference
    case .community(let reference, _, _, _, _): reference
    }
}

/// When it was posted, as a time line between messages says it.
func postedAt(_ millis: UInt64) -> String {
    timeLine(Dates.at(millis))
}

/// What hiding (or, with `remove`, removing) a reported target is, for a post or a comment; nil for anything
/// else, which a moderator only closes.
func moderation(_ kind: ReportTargetKind, remove: Bool) -> ModerationAction? {
    switch kind {
    case .post: remove ? .removePost : .hidePost
    case .comment: remove ? .removeComment : .hideComment
    case .community, .account: nil
    }
}

/// The card a reported target is shown as, for a post or a comment; nil for anything else.
func cardRef(_ target: ReportTarget) -> CardRef? {
    switch target.kind {
    case .post: CardRef(kind: .post, id: target.id)
    case .comment: CardRef(kind: .comment, id: target.id)
    case .community, .account: nil
    }
}
