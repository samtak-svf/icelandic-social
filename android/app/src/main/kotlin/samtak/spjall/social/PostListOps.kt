package samtak.spjall.social

import samtak.spjall.core.Post

/** The list with [changed] in the place of the post it replaces; the one rule for every screen that lists posts. */
internal fun List<Post>.replacing(changed: Post): List<Post> = map { if (it.postId == changed.postId) changed else it }

/** The list without the post [postId]. */
internal fun List<Post>.without(postId: String): List<Post> = filterNot { it.postId == postId }

/** The list followed by the posts of [page] it does not hold yet, so a post that moved between pages shows once. */
internal fun List<Post>.followedBy(page: List<Post>): List<Post> {
    val have = mapTo(HashSet()) { it.postId }
    return this + page.filter { it.postId !in have }
}
