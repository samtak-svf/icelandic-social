package samtak.spjall.social

import samtak.spjall.core.Community
import samtak.spjall.core.CoreClient
import samtak.spjall.core.HomePage
import samtak.spjall.core.Post
import samtak.spjall.core.PostImage
import samtak.spjall.core.PostPage
import samtak.spjall.core.PostTarget

/** The feed calls of [Social] (decision 0116), apart so each file stays under the cap. */
interface SocialHome {
    /** A page of posts across every community this account belongs to. */
    fun feed(
        before: String?,
        limit: UInt,
    ): PostPage

    /**
     * A page of the home feed, newest first: `More` carries the cursor of the page after it, however few posts
     * it holds, and only `End` says there is no more.
     */
    fun home(
        before: String?,
        limit: UInt,
    ): HomePage

    /** The communities the composer offers beside the own wall. */
    fun postCommunities(): List<Community>

    /** Posts to [target]; [poll] holds the options of a poll post. */
    fun postTo(
        target: PostTarget,
        body: String,
        media: List<String>,
        poll: List<String>?,
    ): Post

    /** Uploads an image for a post to [target]. */
    fun uploadPostImageFor(
        target: PostTarget,
        path: String,
    ): PostImage
}

/** [SocialHome] over the core's client. */
class CoreHome(
    private val lazyClient: Lazy<CoreClient>,
) : SocialHome {
    private val client by lazyClient

    override fun feed(
        before: String?,
        limit: UInt,
    ) = client.feed(before, limit)

    override fun home(
        before: String?,
        limit: UInt,
    ) = client.home(before, limit)

    override fun postCommunities() = client.postCommunities()

    override fun postTo(
        target: PostTarget,
        body: String,
        media: List<String>,
        poll: List<String>?,
    ) = client.postTo(target, body, media, poll)

    override fun uploadPostImageFor(
        target: PostTarget,
        path: String,
    ) = client.uploadPostImageFor(target, path)
}
