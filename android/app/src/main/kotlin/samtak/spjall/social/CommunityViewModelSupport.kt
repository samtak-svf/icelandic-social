package samtak.spjall.social

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
        posts = posts.map { if (it.postId == changed.postId) changed else it },
        community =
            community?.copy(featured = community.featured.map { if (it.postId == changed.postId) changed else it }),
    )
