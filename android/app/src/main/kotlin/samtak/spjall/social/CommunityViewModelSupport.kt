package samtak.spjall.social

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import samtak.spjall.conversation.Picked
import samtak.spjall.core.CoreException
import samtak.spjall.core.Post

/** What the server's refusal of an image says, or null when it is not about an image. */
internal fun CoreException.imageNotice(): CommunityViewModel.ImageNotice? =
    when ((this as? CoreException.Refused)?.code) {
        "too_large" -> CommunityViewModel.ImageNotice.TooLarge
        "invalid_image" -> CommunityViewModel.ImageNotice.Invalid
        else -> null
    }

/** The post as the server now has it, in the feed and among the featured. */
internal fun CommunityViewModel.State.replacing(changed: Post): CommunityViewModel.State =
    copy(
        posts = posts.replacing(changed),
        community =
            community?.copy(featured = community.featured.map { if (it.postId == changed.postId) changed else it }),
    )

/**
 * Of the images [picked], those a post with [room] places left takes: the first [room] that are within the server's
 * limit, and the notice for what was left out (null when all fit). The one rule for a community post and a wall post.
 */
internal fun fitting(
    picked: List<Picked>,
    room: Int,
): Pair<List<Picked>, CommunityViewModel.ImageNotice?> {
    val fits = picked.take(room)
    val taken = fits.filter { (it.size ?: 0L) <= IMAGE_LIMIT }
    val notice =
        when {
            taken.size < fits.size -> CommunityViewModel.ImageNotice.TooLarge
            fits.size < picked.size -> CommunityViewModel.ImageNotice.TooMany
            else -> null
        }
    return taken to notice
}

/**
 * Copies each of [taken] off the main thread, one after another, and hands its path to [add] while the post still
 * has room ([have] counts what it holds); a file that cannot be read calls [failed].
 */
internal suspend fun copyPicked(
    taken: List<Picked>,
    io: CoroutineDispatcher,
    have: () -> Int,
    add: (String) -> Unit,
    failed: () -> Unit,
) {
    for (one in taken) {
        try {
            val file = withContext(io) { one.read() }
            if (have() < IMAGES) add(file.path) else withContext(io) { file.delete() }
        } catch (_: java.io.IOException) {
            failed()
        }
    }
}
