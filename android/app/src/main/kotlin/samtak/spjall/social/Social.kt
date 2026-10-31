package samtak.spjall.social

import samtak.spjall.core.Author
import samtak.spjall.core.Card
import samtak.spjall.core.CardRef
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityImagePage
import samtak.spjall.core.CommunityMember
import samtak.spjall.core.CommunityPage
import samtak.spjall.core.CoreClient
import samtak.spjall.core.Frame
import samtak.spjall.core.Framing
import samtak.spjall.core.JoinRequest
import samtak.spjall.core.JoinState
import samtak.spjall.core.ModerationAction
import samtak.spjall.core.ModerationLogPage
import samtak.spjall.core.Post
import samtak.spjall.core.PostImage
import samtak.spjall.core.PostPage
import samtak.spjall.core.ReportPage
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportState
import samtak.spjall.core.ReportTarget

/**
 * What the community screens ask of the core (decisions 0060, 0063, 0066, 0067). This content is hosted, not
 * end-to-end encrypted: every call goes to the server and nothing of it is kept in the conversation store.
 * Every call blocks on the network, so callers run it off the main thread; the view models depend on this
 * rather than on [CoreClient], so their tests need no native library. One function per core call.
 */
@Suppress("TooManyFunctions")
interface Social :
    SocialNotifications,
    SocialFriends,
    SocialComments,
    SocialHome {
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

    /** Takes back a join request that waits; no error when none does. */
    fun withdrawJoinRequest(id: String)

    /** The join requests that wait in a private community, oldest first; for its owner and moderators. */
    fun joinRequests(communityId: String): List<JoinRequest>

    /** Makes the account that asked a member. */
    fun approveJoinRequest(
        communityId: String,
        accountId: String,
    )

    /** Declines a request; the account may ask again after 30 days (decision 0070). */
    fun declineJoinRequest(
        communityId: String,
        accountId: String,
    )

    /** Deletes a community this account owns; it can be restored for 30 days (decision 0070). */
    fun deleteCommunity(communityId: String)

    /** Renames a community, changes its description, or changes its audience when allowed. */
    fun updateCommunity(
        communityId: String,
        name: String?,
        description: String?,
        audience: CommunityAudience?,
    ): Community

    /** The community's members, its owner and moderators first. */
    fun communityMembers(communityId: String): List<CommunityMember>

    /** Makes a member a moderator, or a moderator a member again. */
    fun setCommunityRole(
        communityId: String,
        accountId: String,
        role: samtak.spjall.core.CommunityRole,
    )

    /** This account: its id, to tell its own posts and comments from others', and its name and photo. */
    fun me(): OwnAccount

    /** A page of a community's posts, newest first; [before] is the `next` of the page before. */
    fun communityPosts(
        communityId: String,
        before: String?,
        limit: UInt,
        query: String? = null,
    ): PostPage

    /** A post of text, up to four images from [uploadPostImage] by their media ids, or both. */
    fun createPost(
        communityId: String,
        body: String,
        media: List<String>,
    ): Post

    /** [createPost] with a poll (2 to 6 option texts) or without the author's name (0090, 0091). */
    fun createPostWith(
        communityId: String,
        body: String,
        media: List<String>,
        anonymous: Boolean,
        poll: List<String>?,
    ): Post

    /** Votes for an option of a poll, or changes the vote to it. */
    fun votePoll(
        postId: String,
        optionId: String,
    ): Post

    /** Takes this account's vote back. */
    fun withdrawVote(postId: String): Post

    /** Closes a poll (its author or a moderator). */
    fun closePoll(postId: String): Post

    /** A page of the community's pictures, newest first (0089); [cursor] is the `next` of the page before. */
    fun communityImages(
        communityId: String,
        cursor: String?,
        limit: UInt,
    ): CommunityImagePage

    /** Lets members post without their name, or stops it (the owner's, 0091). */
    fun setAnonymousPosts(
        communityId: String,
        on: Boolean,
    ): Community

    /** The anonymous posts that wait for a moderator, newest first (0091). */
    fun pendingAnonymousPosts(
        communityId: String,
        before: String?,
        limit: UInt,
    ): PostPage

    /** Publishes a waiting anonymous post. */
    fun approveAnonymousPost(postId: String)

    /** Deletes a waiting anonymous post; its author is told. */
    fun declineAnonymousPost(postId: String)

    /** Who wrote an anonymous post (a moderator's; the log records who asked). */
    fun revealAuthor(postId: String): Author

    /** Uploads the image file at [path] for a post in the community; its media id goes in [createPost]. */
    fun uploadPostImage(
        communityId: String,
        path: String,
    ): PostImage

    /** The path of a post's image, a WebP the core fetched once and keeps. */
    fun postImage(
        postId: String,
        mediaId: String,
    ): String

    fun post(postId: String): Post

    /** Deletes this account's own post. */
    fun deletePost(postId: String)

    /** This account's one reaction on a post, in place of any other. */
    fun react(
        postId: String,
        emoji: String,
    )

    /** Takes this account's reaction off a post. */
    fun unreact(postId: String)

    /** Sets the community picture from the image file at [path]; returns its version (0080). */
    fun setCommunityAvatar(
        communityId: String,
        path: String,
    ): String

    /** Sets the community cover from the image file at [path]; returns its version (0080). */
    fun setCommunityCover(
        communityId: String,
        path: String,
    ): String

    /** Removes the community picture. */
    fun removeCommunityAvatar(communityId: String)

    /** Removes the community cover. */
    fun removeCommunityCover(communityId: String)

    /** The file of a community's picture at [version], its `photo`; null when none is visible (0080). */
    fun communityPicture(
        communityId: String,
        version: String,
    ): String?

    /** The file of a community's cover at [version], its `cover`; null when none is visible (0080). */
    fun communityCover(
        communityId: String,
        version: String,
    ): String?

    /** Frames the community picture again from the master the server kept (0086); returns the new version. */
    fun setCommunityPictureFraming(
        communityId: String,
        framing: Framing,
    ): String

    /** Frames the community cover again; a rectangle in the framing's overrides sets one size class (0086). */
    fun setCommunityCoverFraming(
        communityId: String,
        framing: Framing,
    ): String

    /** Writes the master of the community picture to [path] for the editor; false when there is none. */
    fun communityPictureSource(
        communityId: String,
        path: String,
    ): Boolean

    /** Writes the master of the community cover to [path] for the editor; false when there is none. */
    fun communityCoverSource(
        communityId: String,
        path: String,
    ): Boolean

    /** The file of a community's picture at [version] in [frame] (`SQUARE`), as [communityPicture] (0086). */
    fun communityPictureFramed(
        communityId: String,
        version: String,
        frame: Frame,
    ): String?

    /** The file of a community's cover at [version] in [frame], chosen by the window's width (0086). */
    fun communityCoverFramed(
        communityId: String,
        version: String,
        frame: Frame,
    ): String?

    /** Pins a post to the top of its community (moderators and owners). */
    fun pinPost(
        communityId: String,
        postId: String,
    )

    /** Unpins a post. */
    fun unpinPost(
        communityId: String,
        postId: String,
    )

    /** Pins a community to the top of this account's hub. */
    fun pinCommunity(communityId: String)

    /** Unpins a community. */
    fun unpinCommunity(communityId: String)

    /** Reports content to the community's moderators; the server sends unlawful content to the platform's. */
    fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    )

    /** A page of a community's reports in [state], for its moderators. */
    fun communityReports(
        communityId: String,
        state: ReportState,
        after: String?,
        limit: UInt,
    ): ReportPage

    /**
     * One moderator's action on [targetId], answering [reportId]; the community's log keeps the [reason]. [until]
     * (Unix milliseconds) goes with a mute and nothing else.
     */
    fun moderate(
        communityId: String,
        action: ModerationAction,
        targetId: String,
        reason: String,
        reportId: String?,
        until: ULong?,
    )

    /** Closes a report with what was done about it. */
    fun closeReport(
        reportId: String,
        resolution: String,
    )

    /** A page of the community's moderation log, newest first. */
    fun communityModerationLog(
        communityId: String,
        before: String?,
        limit: UInt,
    ): ModerationLogPage

    /** What each reference shows, one card each in their order. */
    fun cards(refs: List<CardRef>): List<Card>
}

/** [Social] over the core's client, the one [samtak.spjall.account.CoreAccount] uses. */
@Suppress("TooManyFunctions")
class CoreSocial private constructor(
    private val lazyClient: Lazy<CoreClient>,
) : Social,
    SocialNotifications by CoreNotifications(lazyClient),
    SocialFriends by CoreFriends(lazyClient),
    SocialComments by CoreComments(lazyClient),
    SocialHome by CoreHome(lazyClient) {
    constructor(open: () -> CoreClient) : this(lazy(open))

    private val client by lazyClient

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

    override fun withdrawJoinRequest(id: String) = client.withdrawJoinRequest(id)

    override fun joinRequests(communityId: String) = client.joinRequests(communityId)

    override fun approveJoinRequest(
        communityId: String,
        accountId: String,
    ) = client.approveJoinRequest(communityId, accountId)

    override fun declineJoinRequest(
        communityId: String,
        accountId: String,
    ) = client.declineJoinRequest(communityId, accountId)

    override fun deleteCommunity(communityId: String) = client.deleteCommunity(communityId)

    override fun updateCommunity(
        communityId: String,
        name: String?,
        description: String?,
        audience: CommunityAudience?,
    ) = client.updateCommunity(communityId, name, description, audience)

    override fun communityMembers(communityId: String) = client.communityMembers(communityId)

    override fun setCommunityRole(
        communityId: String,
        accountId: String,
        role: samtak.spjall.core.CommunityRole,
    ) = client.setCommunityRole(communityId, accountId, role)

    override fun me() = client.me().own()

    override fun communityPosts(
        communityId: String,
        before: String?,
        limit: UInt,
        query: String?,
    ) = client.communityPosts(communityId, before, limit, query)

    override fun createPost(
        communityId: String,
        body: String,
        media: List<String>,
    ) = client.createPost(communityId, body, media)

    override fun createPostWith(
        communityId: String,
        body: String,
        media: List<String>,
        anonymous: Boolean,
        poll: List<String>?,
    ) = client.createPostWith(communityId, body, media, anonymous, poll)

    override fun votePoll(
        postId: String,
        optionId: String,
    ) = client.votePoll(postId, optionId)

    override fun withdrawVote(postId: String) = client.withdrawVote(postId)

    override fun closePoll(postId: String) = client.closePoll(postId)

    override fun communityImages(
        communityId: String,
        cursor: String?,
        limit: UInt,
    ) = client.communityImages(communityId, cursor, limit)

    override fun setAnonymousPosts(
        communityId: String,
        on: Boolean,
    ) = client.setAnonymousPosts(communityId, on)

    override fun pendingAnonymousPosts(
        communityId: String,
        before: String?,
        limit: UInt,
    ) = client.pendingAnonymousPosts(communityId, before, limit)

    override fun approveAnonymousPost(postId: String) = client.approveAnonymousPost(postId)

    override fun declineAnonymousPost(postId: String) = client.declineAnonymousPost(postId)

    override fun revealAuthor(postId: String) = client.revealAuthor(postId)

    override fun uploadPostImage(
        communityId: String,
        path: String,
    ) = client.uploadPostImage(communityId, path)

    override fun postImage(
        postId: String,
        mediaId: String,
    ) = client.postImage(postId, mediaId)

    override fun post(postId: String) = client.post(postId)

    override fun deletePost(postId: String) = client.deletePost(postId)

    override fun react(
        postId: String,
        emoji: String,
    ) = client.react(postId, emoji)

    override fun unreact(postId: String) = client.unreact(postId)

    override fun setCommunityAvatar(
        communityId: String,
        path: String,
    ) = client.setCommunityAvatar(communityId, path)

    override fun setCommunityCover(
        communityId: String,
        path: String,
    ) = client.setCommunityCover(communityId, path)

    override fun removeCommunityAvatar(communityId: String) = client.removeCommunityAvatar(communityId)

    override fun removeCommunityCover(communityId: String) = client.removeCommunityCover(communityId)

    override fun communityPicture(
        communityId: String,
        version: String,
    ) = client.communityPicture(communityId, version)

    override fun communityCover(
        communityId: String,
        version: String,
    ) = client.communityCover(communityId, version)

    override fun setCommunityPictureFraming(
        communityId: String,
        framing: Framing,
    ) = client.setCommunityPictureFraming(communityId, framing)

    override fun setCommunityCoverFraming(
        communityId: String,
        framing: Framing,
    ) = client.setCommunityCoverFraming(communityId, framing)

    override fun communityPictureSource(
        communityId: String,
        path: String,
    ) = client.communityPictureSource(communityId, path)

    override fun communityCoverSource(
        communityId: String,
        path: String,
    ) = client.communityCoverSource(communityId, path)

    override fun communityPictureFramed(
        communityId: String,
        version: String,
        frame: Frame,
    ) = client.communityPictureFramed(communityId, version, frame)

    override fun communityCoverFramed(
        communityId: String,
        version: String,
        frame: Frame,
    ) = client.communityCoverFramed(communityId, version, frame)

    override fun pinPost(
        communityId: String,
        postId: String,
    ) = client.pinPost(communityId, postId)

    override fun unpinPost(
        communityId: String,
        postId: String,
    ) = client.unpinPost(communityId, postId)

    override fun pinCommunity(communityId: String) = client.pinCommunity(communityId)

    override fun unpinCommunity(communityId: String) = client.unpinCommunity(communityId)

    override fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    ) = client.report(target, reason, note, false)

    override fun communityReports(
        communityId: String,
        state: ReportState,
        after: String?,
        limit: UInt,
    ) = client.communityReports(communityId, state, after, limit)

    override fun moderate(
        communityId: String,
        action: ModerationAction,
        targetId: String,
        reason: String,
        reportId: String?,
        until: ULong?,
    ) = client.moderate(communityId, action, targetId, reason, reportId, until)

    override fun closeReport(
        reportId: String,
        resolution: String,
    ) = client.closeReport(reportId, resolution)

    override fun communityModerationLog(
        communityId: String,
        before: String?,
        limit: UInt,
    ) = client.communityModerationLog(communityId, before, limit)

    override fun cards(refs: List<CardRef>) = client.cards(refs)
}
