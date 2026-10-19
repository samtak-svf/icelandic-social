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
    /// Takes back a request to join that waits; no error when none does.
    func withdrawJoinRequest(_ id: String) throws
    /// A page of a community's posts, newest first.
    func communityPosts(_ community: String, before: String?, limit: UInt32) throws -> PostPage
    /// A post of text, up to four images from `uploadPostImage` by their media ids (decision 0065), or both.
    func createPost(_ community: String, body: String, media: [String]) throws -> Post
    /// Uploads the image file at `path` for a post in the community; its media id goes in `createPost`.
    func uploadPostImage(_ community: String, path: String) throws -> PostImage
    /// The path of a post's image, a WebP the core fetched once and keeps.
    func postImage(_ post: String, media: String) throws -> String
    func post(_ id: String) throws -> Post
    /// Deletes this account's own post.
    func deletePost(_ id: String) throws
    /// Sets this account's one reaction on a post, in place of any other.
    func react(_ post: String, kind: ReactionKind) throws
    func unreact(_ post: String) throws
    /// A page of a post's comments, oldest first.
    func comments(_ post: String, after: String?, limit: UInt32) throws -> CommentPage
    func createComment(_ post: String, body: String) throws -> Comment
    /// Deletes this account's own comment.
    func deleteComment(_ id: String) throws
    /// Reports to the moderators, who are never told who reported; the server sends what is unlawful to the
    /// platform's own.
    func report(_ target: ReportTarget, reason: ReportReason, note: String) throws
    /// A page of a community's reports in `state`, open or closed, for its moderators.
    func reports(_ community: String, state: ReportState, after: String?, limit: UInt32) throws -> ReportPage
    /// One moderator's action on a post, a comment or a member, answering `report` when there is one. `until`
    /// (Unix milliseconds) goes with a mute and nothing else (0063).
    func moderate(
        _ community: String, action: ModerationAction, target: String, reason: String, report: String?,
        until: UInt64?
    ) throws
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

    func withdrawJoinRequest(_ id: String) throws { try core().withdrawJoinRequest(communityId: id) }

    func communityPosts(_ community: String, before: String?, limit: UInt32) throws -> PostPage {
        try core().communityPosts(communityId: community, before: before, limit: limit)
    }

    func createPost(_ community: String, body: String, media: [String]) throws -> Post {
        try core().createPost(communityId: community, body: body, media: media)
    }

    func uploadPostImage(_ community: String, path: String) throws -> PostImage {
        try core().uploadPostImage(communityId: community, path: path)
    }

    func postImage(_ post: String, media: String) throws -> String {
        try core().postImage(postId: post, mediaId: media)
    }

    func post(_ id: String) throws -> Post { try core().post(postId: id) }

    func deletePost(_ id: String) throws { try core().deletePost(postId: id) }

    func react(_ post: String, kind: ReactionKind) throws { try core().react(postId: post, kind: kind) }

    func unreact(_ post: String) throws { try core().unreact(postId: post) }

    func comments(_ post: String, after: String?, limit: UInt32) throws -> CommentPage {
        try core().comments(postId: post, after: after, limit: limit)
    }

    func createComment(_ post: String, body: String) throws -> Comment {
        try core().createComment(postId: post, body: body)
    }

    func deleteComment(_ id: String) throws { try core().deleteComment(commentId: id) }

    func report(_ target: ReportTarget, reason: ReportReason, note: String) throws {
        try core().report(target: target, reason: reason, note: note, toPlatform: false)
    }

    func reports(_ community: String, state: ReportState, after: String?, limit: UInt32) throws -> ReportPage {
        try core().communityReports(communityId: community, state: state, after: after, limit: limit)
    }

    func moderate(
        _ community: String, action: ModerationAction, target: String, reason: String, report: String?,
        until: UInt64?
    ) throws {
        try core().moderate(
            communityId: community, action: action, targetId: target, reason: reason, reportId: report, until: until)
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

/// What a moderator may do about a report: the first three to the post or comment it names, the next one to the
/// report alone, the last four to its author.
enum ModerationVerb: Sendable, CaseIterable {
    case hide, remove, restore, dismiss, mute, unmute, ban, unban

    /// The verb acts on the author of what was reported, rather than on the content.
    var onMember: Bool { [.mute, .unmute, .ban, .unban].contains(self) }
}

/// How long a moderator mutes an author (decision 0063): a mute is always for a time.
enum MutePeriod: Sendable, CaseIterable {
    case day, week, month

    var days: UInt64 {
        switch self {
        case .day: 1
        case .week: 7
        case .month: 30
        }
    }

    /// When a mute that starts at `now` (Unix milliseconds) ends.
    func until(_ now: UInt64) -> UInt64 { now + days * 86_400_000 }
}

/// The account a report's member verbs act on: whose content it is, or the account reported; none once deleted.
func member(_ report: Report) -> String? {
    report.targetAccount?.accountId ?? (report.target.kind == .account ? report.target.id : nil)
}

/// What `verb` does about `report`: to the post or comment it names, or to its author. A community is not
/// moderated here, an account's content is not hidden, a deleted author is not muted or banned, and closing a
/// report is no moderation at all.
func moderation(_ report: Report, _ verb: ModerationVerb) -> ModerationAction? {
    switch verb {
    case .mute, .unmute, .ban, .unban:
        guard member(report) != nil else { return nil }
        switch verb {
        case .mute: return .muteMember
        case .unmute: return .unmuteMember
        case .ban: return .banMember
        default: return .unbanMember
        }
    case .dismiss:
        return nil
    case .hide, .remove, .restore:
        switch report.target.kind {
        case .post: return verb == .hide ? .hidePost : verb == .remove ? .removePost : .restorePost
        case .comment: return verb == .hide ? .hideComment : verb == .remove ? .removeComment : .restoreComment
        case .community, .account: return nil
        }
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
