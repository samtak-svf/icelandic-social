package samtak.spjall.social

import samtak.spjall.core.Card
import samtak.spjall.core.CardRef
import samtak.spjall.core.Comment
import samtak.spjall.core.CommentPage
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityPage
import samtak.spjall.core.CoreClient
import samtak.spjall.core.JoinState
import samtak.spjall.core.ModerationAction
import samtak.spjall.core.Post
import samtak.spjall.core.PostPage
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.ReportPage
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportState
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.SocialNotificationPage

/**
 * What the community screens ask of the core (decisions 0060, 0063, 0066, 0067). This content is hosted, not
 * end-to-end encrypted: every call goes to the server and nothing of it is kept in the conversation store.
 * Every call blocks on the network, so callers run it off the main thread; the view models depend on this
 * rather than on [CoreClient], so their tests need no native library. One function per core call.
 */
@Suppress("TooManyFunctions")
interface Social {
    /** A page of the communities this account may see, [query] matching their names; [after] is the `next` before. */
    fun communities(
        query: String?,
        after: String?,
        limit: UInt,
    ): CommunityPage

    /** Every community this account is a member of. */
    fun myCommunities(): List<Community>

    /** A new community, owned by this account; the server takes it only from a verified one. */
    fun createCommunity(
        name: String,
        description: String,
        audience: CommunityAudience,
    ): Community

    /** One community; `Refused` 404 for none this account may see. */
    fun community(id: String): Community

    /** Joins an open community at once, or asks a private one's moderators. */
    fun joinCommunity(id: String): JoinState

    /** Leaves a community; its owner is `Refused` 409. */
    fun leaveCommunity(id: String)

    /** A page of a community's posts, newest first; [before] is the `next` of the page before. */
    fun communityPosts(
        communityId: String,
        before: String?,
        limit: UInt,
    ): PostPage

    fun createPost(
        communityId: String,
        body: String,
    ): Post

    fun post(postId: String): Post

    /** This account's one reaction on a post, in place of any other. */
    fun react(
        postId: String,
        kind: ReactionKind,
    )

    /** Takes this account's reaction off a post. */
    fun unreact(postId: String)

    /** A page of a post's comments, oldest first; [after] is the `next` of the page before. */
    fun comments(
        postId: String,
        after: String?,
        limit: UInt,
    ): CommentPage

    fun createComment(
        postId: String,
        body: String,
    ): Comment

    /** Reports content to the community's moderators; the server sends unlawful content to the platform's. */
    fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    )

    /** A page of a community's open reports, for its moderators. */
    fun communityReports(
        communityId: String,
        after: String?,
        limit: UInt,
    ): ReportPage

    /** One moderator's action on [targetId], answering [reportId]; the community's log keeps the [reason]. */
    fun moderate(
        communityId: String,
        action: ModerationAction,
        targetId: String,
        reason: String,
        reportId: String?,
    )

    /** Closes a report with what was done about it. */
    fun closeReport(
        reportId: String,
        resolution: String,
    )

    /** What each reference shows, one card each in their order. */
    fun cards(refs: List<CardRef>): List<Card>

    /** A page of this account's notifications, newest first, with how many are unread. */
    fun notifications(
        before: String?,
        limit: UInt,
    ): SocialNotificationPage

    /** Every notification made at or before [upTo], the newest shown, is read. */
    fun readNotifications(upTo: ULong)
}

/** [Social] over the core's client, the one [samtak.spjall.account.CoreAccount] uses. */
@Suppress("TooManyFunctions")
class CoreSocial(
    open: () -> CoreClient,
) : Social {
    private val client by lazy(open)

    override fun communities(
        query: String?,
        after: String?,
        limit: UInt,
    ) = client.communities(query, after, limit)

    override fun myCommunities() = client.myCommunities()

    override fun createCommunity(
        name: String,
        description: String,
        audience: CommunityAudience,
    ) = client.createCommunity(name, description, audience)

    override fun community(id: String) = client.community(id)

    override fun joinCommunity(id: String) = client.joinCommunity(id)

    override fun leaveCommunity(id: String) = client.leaveCommunity(id)

    override fun communityPosts(
        communityId: String,
        before: String?,
        limit: UInt,
    ) = client.communityPosts(communityId, before, limit)

    override fun createPost(
        communityId: String,
        body: String,
    ) = client.createPost(communityId, body)

    override fun post(postId: String) = client.post(postId)

    override fun react(
        postId: String,
        kind: ReactionKind,
    ) = client.react(postId, kind)

    override fun unreact(postId: String) = client.unreact(postId)

    override fun comments(
        postId: String,
        after: String?,
        limit: UInt,
    ) = client.comments(postId, after, limit)

    override fun createComment(
        postId: String,
        body: String,
    ) = client.createComment(postId, body)

    override fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    ) = client.report(target, reason, note, false)

    override fun communityReports(
        communityId: String,
        after: String?,
        limit: UInt,
    ) = client.communityReports(communityId, ReportState.OPEN, after, limit)

    override fun moderate(
        communityId: String,
        action: ModerationAction,
        targetId: String,
        reason: String,
        reportId: String?,
    ) = client.moderate(communityId, action, targetId, reason, reportId, null)

    override fun closeReport(
        reportId: String,
        resolution: String,
    ) = client.closeReport(reportId, resolution)

    override fun cards(refs: List<CardRef>) = client.cards(refs)

    override fun notifications(
        before: String?,
        limit: UInt,
    ) = client.notifications(before, limit)

    override fun readNotifications(upTo: ULong) = client.readNotifications(upTo)
}
