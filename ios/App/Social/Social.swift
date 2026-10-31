import Foundation
import SpjallCore

/// Hosted content (decisions 0060, 0063): communities, their posts, comments and reactions, reports, moderation
/// and the notifications addressed to this account. The server reads all of it to serve it to its audience, so
/// it is kept apart from `Account`, whose conversations are end-to-end encrypted: nothing here is written to the
/// conversation store or to the device at all. Every call asks the server and blocks on the network, so the
/// models make them off the main actor.
protocol Social: Sendable, Friending, Walling {
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
    /// The join requests that wait in a community, for its moderators (#354).
    func joinRequests(_ community: String) throws -> [JoinRequest]
    /// Takes the requesting account in as a member.
    func approveJoinRequest(_ community: String, account: String) throws
    /// Declines the request; the account may ask again after 30 days (decision 0070).
    func declineJoinRequest(_ community: String, account: String) throws
    /// Deletes a community, which its owner may do (#364); it can be restored for 30 days.
    func deleteCommunity(_ id: String) throws
    /// The community's members, its owner and moderators first (decision 0079).
    func communityMembers(_ community: String) throws -> [CommunityMember]
    /// Makes a member a moderator, or a moderator a member again; only the community's owner may.
    func setCommunityRole(_ community: String, account: String, role: CommunityRole) throws
    /// Renames a community, changes its description or makes an open one private; only its owner may.
    func updateCommunity(_ community: String, name: String?, description: String?, audience: CommunityAudience?)
        throws -> Community
    /// A page of a community's moderation log, newest first, for its moderators (decision 0079).
    func communityModerationLog(_ community: String, before: String?, limit: UInt32) throws -> ModerationLogPage
    /// A page of a community's posts, newest first, those whose body matches `query` when there is one.
    func communityPosts(_ community: String, before: String?, limit: UInt32, query: String?) throws -> PostPage
    /// A page of the posts of every community this account is a member of, newest first (decision 0079).
    func feed(before: String?, limit: UInt32) throws -> PostPage
    /// A post of text, up to four images from `uploadPostImage` by their media ids (decision 0065), or both.
    func createPost(_ community: String, body: String, media: [String]) throws -> Post
    /// `createPost` with a poll's options (two to six, decision 0090) and/or posted without the author's name, which
    /// waits for a moderator (decision 0091).
    func createPost(_ community: String, body: String, media: [String], anonymous: Bool, poll: [String]?) throws
        -> Post
    /// A page of the images in a community's posts and comments, newest first (decision 0089).
    func communityImages(_ community: String, cursor: String?, limit: UInt32) throws -> CommunityImagePage
    /// Votes in a poll, or changes the vote; the post as it now reads (decision 0090).
    func votePoll(_ post: String, option: String) throws -> Post
    func withdrawVote(_ post: String) throws -> Post
    /// Closes a poll; its author, the owner or a moderator may.
    func closePoll(_ post: String) throws -> Post
    /// Lets members post without their name, or stops it; only the owner may (decision 0091).
    func setAnonymousPosts(_ community: String, on: Bool) throws -> Community
    /// The anonymous posts that wait for approval, newest first, for the moderators.
    func pendingAnonymousPosts(_ community: String, before: String?, limit: UInt32) throws -> PostPage
    func approveAnonymousPost(_ post: String) throws
    func declineAnonymousPost(_ post: String) throws
    /// Who wrote an anonymous post; the moderation log records who asked.
    func revealAuthor(_ post: String) throws -> Author
    /// Uploads the image file at `path` for a post in the community; its media id goes in `createPost`.
    func uploadPostImage(_ community: String, path: String) throws -> PostImage
    /// The path of a post's image, a WebP the core fetched once and keeps.
    func postImage(_ post: String, media: String) throws -> String
    func post(_ id: String) throws -> Post
    /// Deletes this account's own post.
    func deletePost(_ id: String) throws
    /// Sets this account's one reaction on a post, in place of any other.
    func react(_ post: String, emoji: String) throws
    func unreact(_ post: String) throws
    /// A page of a post's comments, oldest first.
    func comments(_ post: String, after: String?, limit: UInt32) throws -> CommentPage
    /// Comments on a post, a reply when `parentCommentId` names the comment it answers (decision 0071), with at most one image from
    /// `uploadPostImage` by its media id (decision 0082).
    func createComment(_ post: String, body: String, parentCommentId: String?, media: [String]) throws -> Comment
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
    /// Sets the community's picture from the image file at `path` (the master; the framing follows); its new version.
    func setCommunityAvatar(_ community: String, path: String) throws -> String
    func removeCommunityAvatar(_ community: String) throws
    /// Sets the community's cover from the image file at `path` (the master; the framing follows); its new version.
    func setCommunityCover(_ community: String, path: String) throws -> String
    func removeCommunityCover(_ community: String) throws
    /// The core's file for a community's picture at `version`, its `photo`; nil when it has none or the reader may
    /// not see it (decision 0080).
    func communityPicture(_ community: String, version: String) throws -> String?
    /// The core's file for a community's cover at `version`, its `cover` (decision 0080).
    func communityCover(_ community: String, version: String) throws -> String?
    /// Frames the community's picture or cover again from the master the server kept (decision 0086); the new
    /// version. Throws `CoreError.NoMaster` for an image set before masters were kept.
    func setCommunityPictureFraming(_ community: String, _ framing: Framing) throws -> String
    func setCommunityCoverFraming(_ community: String, _ framing: Framing) throws -> String
    /// The core's file for the picture or cover at `version` in `frame`.
    func communityPictureFramed(_ community: String, version: String, frame: Frame) throws -> String?
    func communityCoverFramed(_ community: String, version: String, frame: Frame) throws -> String?
    /// Writes the master of the picture or cover to `path`; false when there is none.
    func communityPictureSource(_ community: String, path: String) throws -> Bool
    func communityCoverSource(_ community: String, path: String) throws -> Bool
    /// Likes a comment, or takes the like back (decision 0080).
    func likeComment(_ comment: String) throws
    func unlikeComment(_ comment: String) throws
    /// Pins a post to the top of its community, or lets it go; only the community's moderators and owner may.
    func pinPost(_ community: String, post: String) throws
    func unpinPost(_ community: String, post: String) throws
    /// Pins a community to the top of this account's own list, or lets it go.
    func pinCommunity(_ community: String) throws
    func unpinCommunity(_ community: String) throws
    /// A page of this account's notifications, newest first, with how many are unread.
    func notifications(before: String?, limit: UInt32) throws -> SocialNotificationPage
    /// Marks read every notification made at or before `upTo`.
    func readNotifications(upTo: UInt64) throws
    /// Records that the list was looked at up to `upTo`: it clears the tab's count and reads no row (0104).
    func seenNotifications(upTo: UInt64) throws
    /// Marks one notification read, or unread again.
    func readNotification(_ id: String, read: Bool) throws
    func deleteNotification(_ id: String) throws
    /// A page of what moderators did to this account's content and why, newest first (0115).
    func moderationStatements(before: String?, limit: UInt32) throws -> ModerationStatementPage
    /// Asks for the one review of a decision about this account's content.
    func askModerationReview(entryId: UInt64) throws
    /// The level for each kind and each community that has one (0106).
    func notificationSettings() throws -> NotificationSettings
    /// Sets the level of the given kinds and leaves the others.
    func setNotificationSettings(kinds: [NotificationKindLevel]) throws
    func setCommunityNotificationLevel(_ community: String, level: NotificationLevel) throws
}

extension Social {
    /// A community's posts, with none of a search's words.
    func communityPosts(_ community: String, before: String?, limit: UInt32) throws -> PostPage {
        try communityPosts(community, before: before, limit: limit, query: nil)
    }

    /// A comment on a post, rather than a reply to one.
    func createComment(_ post: String, body: String) throws -> Comment {
        try createComment(post, body: body, parentCommentId: nil, media: [])
    }
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

    func joinRequests(_ community: String) throws -> [JoinRequest] {
        try core().joinRequests(communityId: community)
    }

    func approveJoinRequest(_ community: String, account: String) throws {
        try core().approveJoinRequest(communityId: community, accountId: account)
    }

    func declineJoinRequest(_ community: String, account: String) throws {
        try core().declineJoinRequest(communityId: community, accountId: account)
    }

    func deleteCommunity(_ id: String) throws { try core().deleteCommunity(communityId: id) }

    func communityMembers(_ community: String) throws -> [CommunityMember] {
        try core().communityMembers(communityId: community)
    }

    func setCommunityRole(_ community: String, account: String, role: CommunityRole) throws {
        try core().setCommunityRole(communityId: community, accountId: account, role: role)
    }

    func updateCommunity(_ community: String, name: String?, description: String?, audience: CommunityAudience?)
        throws -> Community
    {
        try core().updateCommunity(communityId: community, name: name, description: description, audience: audience)
    }

    func communityModerationLog(_ community: String, before: String?, limit: UInt32) throws -> ModerationLogPage {
        try core().communityModerationLog(communityId: community, before: before, limit: limit)
    }

    func communityPosts(_ community: String, before: String?, limit: UInt32, query: String?) throws -> PostPage {
        try core().communityPosts(communityId: community, before: before, limit: limit, query: query)
    }

    func feed(before: String?, limit: UInt32) throws -> PostPage {
        try core().feed(before: before, limit: limit)
    }

    func createPost(_ community: String, body: String, media: [String]) throws -> Post {
        try core().createPost(communityId: community, body: body, media: media)
    }

    func createPost(_ community: String, body: String, media: [String], anonymous: Bool, poll: [String]?) throws
        -> Post
    {
        try core().createPostWith(communityId: community, body: body, media: media, anonymous: anonymous, poll: poll)
    }

    func communityImages(_ community: String, cursor: String?, limit: UInt32) throws -> CommunityImagePage {
        try core().communityImages(communityId: community, cursor: cursor, limit: limit)
    }

    func votePoll(_ post: String, option: String) throws -> Post {
        try core().votePoll(postId: post, optionId: option)
    }

    func withdrawVote(_ post: String) throws -> Post { try core().withdrawVote(postId: post) }

    func closePoll(_ post: String) throws -> Post { try core().closePoll(postId: post) }

    func setAnonymousPosts(_ community: String, on: Bool) throws -> Community {
        try core().setAnonymousPosts(communityId: community, on: on)
    }

    func pendingAnonymousPosts(_ community: String, before: String?, limit: UInt32) throws -> PostPage {
        try core().pendingAnonymousPosts(communityId: community, before: before, limit: limit)
    }

    func approveAnonymousPost(_ post: String) throws { try core().approveAnonymousPost(postId: post) }

    func declineAnonymousPost(_ post: String) throws { try core().declineAnonymousPost(postId: post) }

    func revealAuthor(_ post: String) throws -> Author { try core().revealAuthor(postId: post) }

    func uploadPostImage(_ community: String, path: String) throws -> PostImage {
        try core().uploadPostImage(communityId: community, path: path)
    }

    func postImage(_ post: String, media: String) throws -> String {
        try core().postImage(postId: post, mediaId: media)
    }

    func post(_ id: String) throws -> Post { try core().post(postId: id) }

    func deletePost(_ id: String) throws { try core().deletePost(postId: id) }

    func react(_ post: String, emoji: String) throws { try core().react(postId: post, emoji: emoji) }

    func unreact(_ post: String) throws { try core().unreact(postId: post) }

    func comments(_ post: String, after: String?, limit: UInt32) throws -> CommentPage {
        try core().comments(postId: post, after: after, limit: limit)
    }

    func createComment(_ post: String, body: String, parentCommentId: String?, media: [String]) throws -> Comment {
        try core().createComment(postId: post, body: body, parentCommentId: parentCommentId, media: media)
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

    func setCommunityAvatar(_ community: String, path: String) throws -> String {
        try core().setCommunityAvatar(communityId: community, path: path)
    }

    func removeCommunityAvatar(_ community: String) throws { try core().removeCommunityAvatar(communityId: community) }

    func setCommunityCover(_ community: String, path: String) throws -> String {
        try core().setCommunityCover(communityId: community, path: path)
    }

    func removeCommunityCover(_ community: String) throws { try core().removeCommunityCover(communityId: community) }

    func communityPicture(_ community: String, version: String) throws -> String? {
        try core().communityPicture(communityId: community, version: version)
    }

    func communityCover(_ community: String, version: String) throws -> String? {
        try core().communityCover(communityId: community, version: version)
    }

    func setCommunityPictureFraming(_ community: String, _ framing: Framing) throws -> String {
        try core().setCommunityPictureFraming(communityId: community, framing: framing)
    }

    func setCommunityCoverFraming(_ community: String, _ framing: Framing) throws -> String {
        try core().setCommunityCoverFraming(communityId: community, framing: framing)
    }

    func communityPictureFramed(_ community: String, version: String, frame: Frame) throws -> String? {
        try core().communityPictureFramed(communityId: community, version: version, frame: frame)
    }

    func communityCoverFramed(_ community: String, version: String, frame: Frame) throws -> String? {
        try core().communityCoverFramed(communityId: community, version: version, frame: frame)
    }

    func communityPictureSource(_ community: String, path: String) throws -> Bool {
        try core().communityPictureSource(communityId: community, path: path)
    }

    func communityCoverSource(_ community: String, path: String) throws -> Bool {
        try core().communityCoverSource(communityId: community, path: path)
    }

    func likeComment(_ comment: String) throws { try core().likeComment(commentId: comment) }

    func unlikeComment(_ comment: String) throws { try core().unlikeComment(commentId: comment) }

    func pinPost(_ community: String, post: String) throws {
        try core().pinPost(communityId: community, postId: post)
    }

    func unpinPost(_ community: String, post: String) throws {
        try core().unpinPost(communityId: community, postId: post)
    }

    func pinCommunity(_ community: String) throws { try core().pinCommunity(communityId: community) }

    func unpinCommunity(_ community: String) throws { try core().unpinCommunity(communityId: community) }
}

/// One of the reactions the quick bar offers: its emoji, and the key of the words a screen reader says in place of it.
struct QuickReaction: Hashable {
    let emoji: String
    let label: String
}

/// The reactions of the quick bar, in the order they are offered. Any other single emoji is a reaction too, picked
/// from the full list (decision 0100).
let quickReactions: [QuickReaction] = [
    QuickReaction(emoji: "👍", label: "reaction_like"),
    QuickReaction(emoji: "❤️", label: "reaction_love"),
    QuickReaction(emoji: "😂", label: "reaction_laugh"),
    QuickReaction(emoji: "😮", label: "reaction_wow"),
    QuickReaction(emoji: "😢", label: "reaction_sad"),
    QuickReaction(emoji: "🙏", label: "reaction_pray"),
]

/// What a tap on `Líkar` gives.
let likeEmoji = "👍"

/// The reasons a report gives, in the order they are offered.
let reportReasons: [ReportReason] = [.unlawful, .harassment, .spam, .other]

/// The longest name and description a community takes, as the server holds them.
let communityNameLimit = 80
let communityDescriptionLimit = 500

/// Now, in Unix milliseconds, as the server counts.
@Sendable func nowMillis() -> UInt64 {
    UInt64(Date().timeIntervalSince1970 * 1_000)
}

/// Who wrote it or did it: their name, a word for none, or another for an account deleted since.
func authorName(_ author: Author?) -> String {
    guard let author else { return localized("person_deleted") }
    return author.name ?? localized("person_unnamed")
}

/// What an anonymous post shows in place of a name, or nil when it names its author. The author is nil to every
/// reader but its own author, so who wrote it comes from `mine` and never from comparing ids (decision 0091).
func anonymousByline(_ post: Post) -> String? {
    guard post.author == nil else { return nil }
    return localized(post.mine ? "post_anonymous_mine" : "post_anonymous_author")
}

/// Who a shared or reported post's card names. A card for an anonymous post has no author and carries no `mine`,
/// so it always reads as anonymous (decision 0091).
func cardByline(_ author: Author?) -> String {
    guard let author else { return localized("post_anonymous_author") }
    return authorName(author)
}

/// A community's audience, and how many members it has when this account may know.
func audienceLine(_ community: Community) -> String {
    let audience = localized(community.audience == .open ? "community_open" : "community_private")
    guard let count = community.memberCount else { return audience }
    return "\(audience) · \(plural("community_members", Int(count)))"
}

/// The audience line the community header carries (decision 0080): `community_private_full` and the member count.
func audienceLineFull(_ community: Community) -> String {
    let audience = localized(community.audience == .open ? "community_open_full" : "community_private_full")
    guard let count = community.memberCount else { return audience }
    return "\(audience) · \(plural("community_members", Int(count)))"
}

/// The web address of a community, which is what an open community shares (decision 0080).
func communityLink(_ communityId: String) -> URL? {
    URL(string: "\(webOrigin)/communities/\(communityId)")
}

/// The words for a reaction, which a screen reader says in place of its emoji; an emoji of the full list has no
/// words of its own, and VoiceOver names it.
func reactionLabel(_ emoji: String) -> String {
    quickReactions.first { $0.emoji == emoji }.map { localized($0.label) } ?? emoji
}

func reasonLabel(_ reason: ReportReason) -> String {
    switch reason {
    case .unlawful: localized("report_reason_unlawful")
    case .harassment: localized("report_reason_harassment")
    case .spam: localized("report_reason_spam")
    case .other: localized("report_reason_other")
    }
}

/// `post` with this account's reaction set to `emoji`, or taken off for nil, and the counts moved to match: most
/// given first, equal counts in the order they had, the new emoji last among its equals.
func reacted(_ post: Post, _ emoji: String?) -> Post {
    var changed = post
    var counts = post.emojis
    if let old = post.myEmoji, let index = counts.firstIndex(where: { $0.emoji == old }) {
        counts[index].count -= min(counts[index].count, 1)
    }
    if let emoji {
        if let index = counts.firstIndex(where: { $0.emoji == emoji }) {
            counts[index].count += 1
        } else {
            counts.append(EmojiCount(emoji: emoji, count: 1))
        }
    }
    changed.emojis = counts.filter { $0.count > 0 }.enumerated()
        .sorted { ($0.element.count, $1.offset) > ($1.element.count, $0.offset) }.map(\.element)
    changed.myEmoji = emoji
    return changed
}

/// How many of `emoji` a post has.
func reactionCount(_ post: Post, _ emoji: String) -> UInt64 {
    post.emojis.first { $0.emoji == emoji }?.count ?? 0
}

/// The commonest emoji of a post, most given first, as the line under it shows them.
func summaryEmojis(_ post: Post, limit: Int = 3) -> String {
    post.emojis.filter { $0.count > 0 }.sorted { $0.count > $1.count }.prefix(limit).map(\.emoji).joined()
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

/// The verbs a report offers for its target as it stands now (#361): a post or comment that is visible may be
/// hidden or removed, one hidden or removed restored; its author, by standing, muted, unmuted, banned or
/// unbanned. A state or standing the server did not give, or one a later server adds, offers every verb on
/// that side. Closing without acting is offered on an open report only.
func offeredVerbs(_ report: Report) -> Set<ModerationVerb> {
    var offered: Set<ModerationVerb> = []
    let state = report.targetState ?? .unknown
    let standing = report.targetStanding ?? .unknown
    if state == .unknown || state == .visible { offered.insert(.hide) }
    if state == .unknown || state == .visible || state == .hidden { offered.insert(.remove) }
    if state == .unknown || state == .hidden || state == .removed { offered.insert(.restore) }
    if standing == .unknown || standing == .member { offered.insert(.mute) }
    if standing == .unknown || standing == .muted { offered.insert(.unmute) }
    if standing == .unknown || standing == .member || standing == .muted || standing == .notMember {
        offered.insert(.ban)
    }
    if standing == .unknown || standing == .banned { offered.insert(.unban) }
    if report.state == .open { offered.insert(.dismiss) }
    return offered
}

/// The words for what closed a report.
func decisionLabel(_ decision: ReportDecision) -> String? {
    switch decision {
    case .hidePost: localized("moderation_decision_hide_post")
    case .removePost: localized("moderation_decision_remove_post")
    case .restorePost: localized("moderation_decision_restore_post")
    case .hideComment: localized("moderation_decision_hide_comment")
    case .removeComment: localized("moderation_decision_remove_comment")
    case .restoreComment: localized("moderation_decision_restore_comment")
    case .muteMember: localized("moderation_decision_mute_member")
    case .unmuteMember: localized("moderation_decision_unmute_member")
    case .removeMember: localized("moderation_decision_remove_member")
    case .banMember: localized("moderation_decision_ban_member")
    case .unbanMember: localized("moderation_decision_unban_member")
    case .dismissed: localized("moderation_decision_dismissed")
    case .communityDeleted: localized("moderation_decision_community_deleted")
    case .unknown: nil
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

/// The words for an account's role in a community (decision 0079).
func roleLabel(_ role: CommunityRole) -> String {
    switch role {
    case .owner: localized("community_role_owner")
    case .moderator: localized("community_role_moderator")
    case .member: localized("community_role_member")
    }
}

/// A top-level comment and the replies it takes (decision 0071): one level, never a reply to a reply.
struct CommentThread: Identifiable {
    let comment: Comment
    var replies: [Comment]

    var id: String { comment.commentId }
}

/// A post's comments as their top-level ones, each with the replies to it in the order they came. A reply whose
/// parent is not among `comments` (an older page, or one this account may not see) stands on its own rather than
/// disappearing from the thread.
func commentThreads(_ comments: [Comment]) -> [CommentThread] {
    var threads: [CommentThread] = []
    var at: [String: Int] = [:]
    for comment in comments where comment.parentCommentId == nil {
        at[comment.commentId] = threads.count
        threads.append(CommentThread(comment: comment, replies: []))
    }
    var orphans: [Comment] = []
    for comment in comments {
        guard let parent = comment.parentCommentId else { continue }
        if let index = at[parent] { threads[index].replies.append(comment) } else { orphans.append(comment) }
    }
    for comment in orphans { threads.append(CommentThread(comment: comment, replies: [])) }
    return threads
}

/// A comment a moderator removed, or whose author's account is gone, which the thread stands in for as long as
/// the replies to it are shown (decision 0071).
func isTombstone(_ comment: Comment) -> Bool { comment.state == .removed && comment.body.isEmpty }
