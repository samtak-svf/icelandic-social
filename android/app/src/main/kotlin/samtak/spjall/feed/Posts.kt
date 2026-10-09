package samtak.spjall.feed

import samtak.spjall.core.Post
import samtak.spjall.core.PostReaction
import samtak.spjall.core.ReactionCounts

/** A post's longest body, as the server holds it (decision 0034). */
const val POST_LIMIT = 2000

/** The body as it will be posted, or null when there is nothing to post or too much. */
fun postable(body: String): String? = body.trim().takeIf { it.isNotEmpty() && it.length <= POST_LIMIT }

/** Every reaction the post has, of any kind. */
fun ReactionCounts.total(): UInt = heart + thumbsUp + laugh + wow + sad

/**
 * The post as it is once the heart is pressed: a heart when this account had
 * no reaction, else its reaction taken back, whichever it was.
 */
fun Post.toggledHeart(): Post {
    val counts = reactions
    val mine = myReaction
    return if (mine == null) {
        copy(myReaction = PostReaction.HEART, reactions = counts.copy(heart = counts.heart + 1u))
    } else {
        copy(myReaction = null, reactions = counts.less(mine))
    }
}

private fun ReactionCounts.less(reaction: PostReaction): ReactionCounts =
    when (reaction) {
        PostReaction.HEART -> copy(heart = heart.dec0())
        PostReaction.THUMBS_UP -> copy(thumbsUp = thumbsUp.dec0())
        PostReaction.LAUGH -> copy(laugh = laugh.dec0())
        PostReaction.WOW -> copy(wow = wow.dec0())
        PostReaction.SAD -> copy(sad = sad.dec0())
    }

private fun UInt.dec0(): UInt = if (this == 0u) 0u else this - 1u
