package samtak.spjall.social

import samtak.spjall.brand.R
import samtak.spjall.core.Card
import samtak.spjall.core.Community
import samtak.spjall.core.CommunityAudience
import samtak.spjall.core.CommunityRole
import samtak.spjall.core.EmojiCount
import samtak.spjall.core.Post

/**
 * [Post] with this account's reaction set to [next], none taking it back: the counts as the server gave them,
 * moved by what changed, as the web's post does until it loads the post again.
 */
fun Post.reacted(next: String?): Post {
    val counts = LinkedHashMap(emojis.associate { it.emoji to it.count })
    myEmoji?.let { old -> counts[old] = (counts[old] ?: 0uL).let { if (it > 0uL) it - 1uL else 0uL } }
    next?.let { counts[it] = (counts[it] ?: 0uL) + 1uL }
    // Most used first; equal counts keep the order they had, the new emoji last among its equals.
    return copy(
        myEmoji = next,
        emojis =
            counts.entries
                .filter { it.value > 0uL }
                .sortedByDescending { it.value }
                .map { EmojiCount(it.key, it.value) },
    )
}

/**
 * The byline string of an anonymous post, or null when the post names its author: the author is null to every
 * reader but its own author, so who wrote it comes from [Post.mine] and never from comparing ids (decision 0091).
 */
fun Post.anonymousBylineRes(): Int? =
    when {
        author != null -> null
        mine -> R.string.post_anonymous_mine
        else -> R.string.post_anonymous_author
    }

/**
 * The byline string of a shared or reported post's card when it names no author: a card for an anonymous post has
 * none, and a card carries no `mine`, so it always reads as anonymous (decision 0091).
 */
fun Card.Post.anonymousBylineRes(): Int? = if (author == null) R.string.post_anonymous_author else null

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

/**
 * The string telling a member at [now] why there is no composer, or null when there is one or this
 * account has not joined.
 */
fun Community.noPostNotice(now: Long): Int? =
    when {
        role == null -> null
        readOnly -> R.string.community_read_only
        muted(now) -> R.string.community_muted
        else -> null
    }

/** This post with one comment fewer to count, never below none. */
fun Post.withOneCommentFewer(): Post = if (commentCount > 0uL) copy(commentCount = commentCount - 1uL) else this

/** The longest post the server takes. */
const val POST_LIMIT = 5000

/** The longest comment the server takes. */
const val COMMENT_LIMIT = 2000

/** The longest report note the server takes. */
const val NOTE_LIMIT = 500

/** The longest moderator's reason the server takes. */
const val REASON_LIMIT = 500

/** The longest community name the server takes. */
const val NAME_LIMIT = 80

/** The longest community description the server takes. */
const val DESCRIPTION_LIMIT = 500

/**
 * Presses [emoji] on [post]: it becomes this account's reaction, or, pressed again, is taken back. Blocks on the
 * network; returns the post as it now stands.
 */
fun Social.toggle(
    post: Post,
    emoji: String,
): Post {
    val next = if (post.myEmoji == emoji) null else emoji
    if (next == null) unreact(post.postId) else react(post.postId, next)
    return post.reacted(next)
}
