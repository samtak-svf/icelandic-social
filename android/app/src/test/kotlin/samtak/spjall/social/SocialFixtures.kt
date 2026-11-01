package samtak.spjall.social

import samtak.spjall.core.Author
import samtak.spjall.core.Comment
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.CoreException
import samtak.spjall.core.EmojiCount
import samtak.spjall.core.ModerationState
import samtak.spjall.core.Poll
import samtak.spjall.core.Post
import samtak.spjall.core.Report
import samtak.spjall.core.ReportDecision
import samtak.spjall.core.ReportReason
import samtak.spjall.core.ReportState
import samtak.spjall.core.ReportTarget
import samtak.spjall.core.ReportTargetKind
import samtak.spjall.core.TargetStanding
import samtak.spjall.core.TargetState

val anna = Author("a2", "Anna", verified = true)

/** This account, as [FakeSocial.me] names it. */
val self = Author("a1", "Ég", verified = true)

fun community(
    id: String,
    name: String = "Kórinn",
    audience: CommunityAudience = CommunityAudience.OPEN,
    role: CommunityRole? = null,
    mutedUntil: ULong? = null,
    joinDeclinedUntil: ULong? = null,
    pendingJoinRequests: ULong? = null,
    unread: ULong = 0uL,
    pinned: Boolean = false,
    lastPostAt: ULong? = null,
    anonymousPosts: Boolean = false,
    pendingAnonymous: ULong = 0uL,
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
    joinDeclinedUntil = joinDeclinedUntil,
    pendingJoinRequests = pendingJoinRequests,
    unread = unread,
    pinned = pinned,
    lastPostAt = lastPostAt,
    anonymousPosts = anonymousPosts,
    pendingAnonymous = pendingAnonymous,
)

fun post(
    id: String,
    communityId: String = "k1",
    body: String = "Halló",
    emojis: List<EmojiCount> = emptyList(),
    mine: String? = null,
    comments: ULong = 0uL,
    author: Author? = anna,
    anonymous: Boolean = false,
    own: Boolean = author?.accountId == self.accountId,
    poll: Poll? = null,
    pinned: Boolean = false,
    imported: Boolean = false,
    state: ModerationState = ModerationState.VISIBLE,
) = Post(
    postId = id,
    communityId = communityId,
    author = author,
    anonymous = anonymous,
    mine = own,
    body = body,
    images = emptyList(),
    createdAt = 1_700_000_000_000uL,
    emojis = emojis,
    myEmoji = mine,
    commentCount = comments,
    state = state,
    poll = poll,
    pinned = pinned,
    imported = imported,
)

fun comment(
    id: String,
    postId: String,
    body: String = "Já",
    author: Author = anna,
    parentCommentId: String? = null,
) = Comment(
    commentId = id,
    postId = postId,
    parentCommentId = parentCommentId,
    author = author,
    body = body,
    createdAt = 1_700_000_000_000uL,
    state = ModerationState.VISIBLE,
)

fun report(
    id: String,
    kind: ReportTargetKind,
    targetId: String,
    author: Author? = anna,
    state: ReportState = ReportState.OPEN,
    targetState: TargetState? = null,
    targetStanding: TargetStanding? = null,
    decision: ReportDecision? = null,
    resolution: String? = null,
    closedBy: Author? = null,
    closedAt: ULong? = null,
    anonymous: Boolean = false,
) = Report(
    reportId = id,
    communityId = "k1",
    target = ReportTarget(kind, targetId),
    targetAccount = author,
    reason = ReportReason.SPAM,
    note = "",
    state = state,
    createdAt = 1_700_000_000_000uL,
    closedAt = closedAt,
    decision = decision,
    resolution = resolution,
    closedBy = closedBy,
    targetStanding = targetStanding,
    targetState = targetState,
    targetAnonymous = anonymous,
)

fun notFound() = CoreException.Refused(404u, "not_found", null)
