package samtak.spjall.social

import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.Post
import samtak.spjall.core.ReactionCount
import samtak.spjall.core.ReactionKind

/**
 * [Post] with this account's reaction set to [next], none taking it back: the counts as the server gave them,
 * moved by what changed, as the web's post does until it loads the post again.
 */
fun Post.reacted(next: ReactionKind?): Post {
    val counts = reactions.associate { it.kind to it.count }.toMutableMap()
    myReaction?.let { old -> counts[old] = (counts[old] ?: 0uL).let { if (it > 0uL) it - 1uL else 0uL } }
    next?.let { counts[it] = (counts[it] ?: 0uL) + 1uL }
    return copy(
        myReaction = next,
        reactions =
            ReactionKind.entries.mapNotNull { kind ->
                counts[kind]?.takeIf { it > 0uL }?.let { ReactionCount(kind, it) }
            },
    )
}

/** Whether this account moderates [this]: its owner and its moderators see its report queue. */
val Community.moderates: Boolean
    get() = role == CommunityRole.OWNER || role == CommunityRole.MODERATOR

/** Whether this account may read the posts: a member, or anyone signed in for an open community. */
val Community.reads: Boolean
    get() = role != null || audience == CommunityAudience.OPEN

/** Whether a moderator muted this account here at [now]: it reads but writes nothing. */
fun Community.muted(now: Long): Boolean = mutedUntil?.let { it.toLong() > now } ?: false

/** Whether this account may write a post here at [now]. */
fun Community.writes(now: Long): Boolean = role != null && !readOnly && !muted(now)

/** The longest post the server takes. */
const val POST_LIMIT = 5000

/** The longest comment the server takes. */
const val COMMENT_LIMIT = 2000

/** The longest report note the server takes. */
const val NOTE_LIMIT = 1000

/** The longest moderator's reason the server takes. */
const val REASON_LIMIT = 500

/** The longest community name the server takes. */
const val NAME_LIMIT = 80

/** The longest community description the server takes. */
const val DESCRIPTION_LIMIT = 500

/**
 * Presses [kind] on [post]: it becomes this account's reaction, or, pressed again, is taken back. Blocks on the
 * network; returns the post as it now stands.
 */
fun Social.toggle(
    post: Post,
    kind: ReactionKind,
): Post {
    val next = if (post.myReaction == kind) null else kind
    if (next == null) unreact(post.postId) else react(post.postId, next)
    return post.reacted(next)
}
