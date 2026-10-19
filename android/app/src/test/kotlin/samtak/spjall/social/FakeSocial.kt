package samtak.spjall.social

import samtak.spjall.account.unreachable
import samtak.spjall.core.Author
import samtak.spjall.core.Card
import samtak.spjall.core.CardCommunity
import samtak.spjall.core.CardKind
import samtak.spjall.core.CardRef
import samtak.spjall.core.Comment
import samtak.spjall.core.CommentPage
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityPage
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.CoreException
import samtak.spjall.core.JoinState
import samtak.spjall.core.ModerationAction
import samtak.spjall.core.ModerationState
import samtak.spjall.core.Post
import samtak.spjall.core.PostImage
import samtak.spjall.core.PostPage
import samtak.spjall.core.ReactionKind
import samtak.spjall.core.Report
import samtak.spjall.core.ReportPage
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportState
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind
import samtak.spjall.core.SocialNotification
import samtak.spjall.core.SocialNotificationKind
import samtak.spjall.core.SocialNotificationPage

/**
 * The server's communities as the view models see them, in memory. [failNext] makes the next call throw
 * instead, [failOn] makes every call of that name throw, and [calls] records what was asked, in order.
 */
@Suppress("TooManyFunctions")
class FakeSocial : Social {
    val calls = mutableListOf<String>()
    var failNext: CoreException? = null
    var failOn: String? = null

    /** Every community, by id. */
    val communities = linkedMapOf<String, Community>()

    /** Each community's posts, newest first. */
    val posts = mutableMapOf<String, MutableList<Post>>()

    /** Each post's comments, oldest first. */
    val comments = mutableMapOf<String, MutableList<Comment>>()

    /** Newest first. */
    var notifications = listOf<SocialNotification>()

    /** Up to which time the notifications are read. */
    var readUpTo: ULong = 0uL

    /** Each community's reports, open and closed. */
    val reports = mutableMapOf<String, MutableList<Report>>()

    /** This account's id. */
    var me = "a1"

    /** The server's refusal of the next image uploaded, none taking it. */
    var refuseImage: CoreException? = null

    /** The size of a page when a call asks for more than this; small, to test paging. */
    var pageSize = Int.MAX_VALUE
    private var made = 0

    private fun call(name: String) {
        calls += name
        if (name == failOn) throw unreachable()
        failNext?.let {
            failNext = null
            throw it
        }
    }

    private fun <T> page(
        items: List<T>,
        after: String?,
        limit: UInt,
    ): Pair<List<T>, String?> {
        val start = after?.toInt() ?: 0
        val size = minOf(limit.toInt(), pageSize)
        val end = minOf(items.size, start + size)
        return items.subList(start, end).toList() to (if (end < items.size) "$end" else null)
    }

    override fun communities(
        query: String?,
        after: String?,
        limit: UInt,
    ): CommunityPage {
        call("communities ${query.orEmpty()} ${after.orEmpty()}".trim())
        val found = communities.values.filter { query == null || it.name.contains(query, ignoreCase = true) }
        val (items, next) = page(found, after, limit)
        return CommunityPage(items, next)
    }

    override fun myCommunities(): List<Community> {
        call("myCommunities")
        return communities.values.filter { it.role != null }
    }

    override fun createCommunity(
        name: String,
        description: String,
        audience: CommunityAudience,
    ): Community {
        call("createCommunity $name")
        val new = community("k-new${made++}", name, audience, CommunityRole.OWNER).copy(description = description)
        communities[new.communityId] = new
        return new
    }

    override fun community(id: String): Community {
        call("community $id")
        return communities[id] ?: throw notFound()
    }

    override fun joinCommunity(id: String): JoinState {
        call("joinCommunity $id")
        val community = communities.getValue(id)
        return if (community.audience == CommunityAudience.OPEN) {
            communities[id] = community.copy(role = CommunityRole.MEMBER)
            JoinState.MEMBER
        } else {
            communities[id] = community.copy(joinRequested = true)
            JoinState.REQUESTED
        }
    }

    override fun leaveCommunity(id: String) {
        call("leaveCommunity $id")
        communities[id] = communities.getValue(id).copy(role = null)
    }

    override fun withdrawJoinRequest(id: String) {
        call("withdrawJoinRequest $id")
        communities[id] = communities.getValue(id).copy(joinRequested = false)
    }

    override fun me(): String {
        call("me")
        return me
    }

    override fun communityPosts(
        id: String,
        before: String?,
        limit: UInt,
    ): PostPage {
        call("communityPosts $id ${before.orEmpty()}".trim())
        val (items, next) = page(posts[id].orEmpty(), before, limit)
        return PostPage(items, next)
    }

    override fun createPost(
        communityId: String,
        body: String,
        media: List<String>,
    ): Post {
        call("createPost $communityId $body ${media.joinToString(",")}".trim())
        val post =
            post("p-new${made++}", communityId, body).copy(images = media.map { PostImage(it, 640u, 480u) })
        posts.getOrPut(communityId) { mutableListOf() }.add(0, post)
        return post
    }

    override fun uploadPostImage(
        communityId: String,
        path: String,
    ): PostImage {
        call("uploadPostImage $communityId $path")
        refuseImage?.let {
            refuseImage = null
            throw it
        }
        return PostImage("m-${java.io.File(path).name}", 640u, 480u)
    }

    override fun postImage(
        postId: String,
        mediaId: String,
    ): String {
        call("postImage $postId $mediaId")
        return "/images/$mediaId.webp"
    }

    override fun post(postId: String): Post {
        call("post $postId")
        return posts.values.flatten().firstOrNull { it.postId == postId } ?: throw notFound()
    }

    override fun deletePost(postId: String) {
        call("deletePost $postId")
        posts.values.forEach { list -> list.removeAll { it.postId == postId } }
    }

    override fun react(
        postId: String,
        kind: ReactionKind,
    ) = call("react $postId $kind")

    override fun unreact(postId: String) = call("unreact $postId")

    override fun comments(
        postId: String,
        after: String?,
        limit: UInt,
    ): CommentPage {
        call("comments $postId ${after.orEmpty()}".trim())
        val (items, next) = page(comments[postId].orEmpty(), after, limit)
        return CommentPage(items, next)
    }

    override fun createComment(
        postId: String,
        body: String,
    ): Comment {
        call("createComment $postId $body")
        val comment = comment("c-new${made++}", postId, body)
        comments.getOrPut(postId) { mutableListOf() }.add(comment)
        return comment
    }

    override fun deleteComment(commentId: String) {
        call("deleteComment $commentId")
        comments.values.forEach { list -> list.removeAll { it.commentId == commentId } }
    }

    override fun report(
        target: ReportTarget,
        reason: ReportReason,
        note: String,
    ) = call("report ${target.kind} ${target.id} $reason $note".trim())

    override fun communityReports(
        communityId: String,
        state: ReportState,
        after: String?,
        limit: UInt,
    ): ReportPage {
        call("communityReports $communityId $state")
        val (items, next) = page(reports[communityId].orEmpty().filter { it.state == state }, after, limit)
        return ReportPage(items, next)
    }

    override fun moderate(
        communityId: String,
        action: ModerationAction,
        targetId: String,
        reason: String,
        reportId: String?,
        until: ULong?,
    ) {
        call("moderate $communityId $action $targetId $reason $reportId ${until ?: ""}".trim())
        close(reportId)
    }

    private fun close(reportId: String?) {
        reports.values.forEach { list ->
            list.replaceAll { if (it.reportId == reportId) it.copy(state = ReportState.CLOSED) else it }
        }
    }

    override fun closeReport(
        reportId: String,
        resolution: String,
    ) {
        call("closeReport $reportId $resolution")
        close(reportId)
    }

    override fun cards(refs: List<CardRef>): List<Card> {
        call("cards ${refs.joinToString(",") { it.id }}")
        return refs.map { ref ->
            when (ref.kind) {
                CardKind.POST ->
                    posts.values.flatten().firstOrNull { it.postId == ref.id }?.let {
                        Card.Post(ref, CardCommunity(it.communityId, "K"), it.author, it.body, null, it.createdAt)
                    }
                CardKind.COMMENT ->
                    comments.values.flatten().firstOrNull { it.commentId == ref.id }?.let {
                        Card.Comment(ref, CardCommunity("k1", "K"), it.postId, it.author, it.body, it.createdAt)
                    }
                CardKind.COMMUNITY -> null
            } ?: Card.Unavailable(ref)
        }
    }

    override fun notifications(
        before: String?,
        limit: UInt,
    ): SocialNotificationPage {
        call("notifications ${before.orEmpty()} $limit".replace("  ", " "))
        val shown = notifications.map { it.copy(read = it.createdAt <= readUpTo) }
        val (items, next) = page(shown, before, limit)
        return SocialNotificationPage(items, shown.count { !it.read }.toULong(), next)
    }

    override fun readNotifications(upTo: ULong) {
        call("readNotifications $upTo")
        readUpTo = maxOf(readUpTo, upTo)
    }
}

val anna = Author("a2", "Anna", verified = true)

/** This account, as [FakeSocial.me] names it. */
val self = Author("a1", "Ég", verified = true)

fun community(
    id: String,
    name: String = "Kórinn",
    audience: CommunityAudience = CommunityAudience.OPEN,
    role: CommunityRole? = null,
    mutedUntil: ULong? = null,
) = Community(
    communityId = id,
    name = name,
    description = "",
    audience = audience,
    createdAt = 1_700_000_000_000uL,
    memberCount = 3uL,
    role = role,
    joinRequested = false,
    invited = false,
    mutedUntil = mutedUntil,
    readOnly = false,
    deletedAt = null,
    joinDeclinedUntil = null,
    pendingJoinRequests = null,
)

fun post(
    id: String,
    communityId: String = "k1",
    body: String = "Halló",
    reactions: List<samtak.spjall.core.ReactionCount> = emptyList(),
    mine: ReactionKind? = null,
    comments: ULong = 0uL,
    author: Author = anna,
) = Post(
    postId = id,
    communityId = communityId,
    author = author,
    body = body,
    images = emptyList(),
    createdAt = 1_700_000_000_000uL,
    reactions = reactions,
    myReaction = mine,
    commentCount = comments,
    state = ModerationState.VISIBLE,
)

fun comment(
    id: String,
    postId: String,
    body: String = "Já",
    author: Author = anna,
) = Comment(
    commentId = id,
    postId = postId,
    author = author,
    body = body,
    createdAt = 1_700_000_000_000uL,
    state = ModerationState.VISIBLE,
)

fun notification(
    id: String,
    kind: SocialNotificationKind,
    createdAt: ULong,
    postId: String? = "p1",
) = SocialNotification(
    notificationId = id,
    kind = kind,
    actor = anna,
    communityId = "k1",
    postId = postId,
    commentId = null,
    action = null,
    createdAt = createdAt,
    read = false,
)

fun report(
    id: String,
    kind: ReportTargetKind,
    targetId: String,
    author: Author? = anna,
    state: ReportState = ReportState.OPEN,
) = Report(
    reportId = id,
    communityId = "k1",
    target = ReportTarget(kind, targetId),
    targetAccount = author,
    reason = ReportReason.SPAM,
    note = "",
    state = state,
    createdAt = 1_700_000_000_000uL,
    closedAt = null,
    decision = null,
    resolution = null,
    closedBy = null,
    targetStanding = null,
    targetState = null,
)

fun notFound() = CoreException.Refused(404u, "not_found", null)
